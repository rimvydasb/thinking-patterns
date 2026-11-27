import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {newMapFileModel, serializeMapFile} from '../../../app/mindmap/model/mapFile/serialize';
import {findByPath} from '../../../app/mindmap/model/topicPath';
import {fromOutline, toOutline} from '../../../app/mindmap/model/tree';
import type {Outline} from '../../../app/mindmap/model/types';
import type {MapEvent} from '../../map/mapDocument';
import {createMapWorkspace, type MapWorkspace} from '../../map/mapWorkspace';
import {MemoryFsPort} from '../../map/testing/memoryFsPort';
import {createMcpServer, NO_FILE_MESSAGE} from '../tools';

const FILE = '/maps/plan.map.md';
const workspaces: MapWorkspace[] = [];
afterEach(async () => {
    for (const w of workspaces.splice(0)) await w.close();
});

/** An MCP client for a workspace with `outline` in an open map file (or no open file with `open: false`). */
async function setup(outline?: Outline, opts: {open?: boolean} = {}) {
    const fs = new MemoryFsPort();
    fs.mkdirp('/maps');
    const model = newMapFileModel();
    if (outline) model.tree = fromOutline(outline);
    fs.writeExternal(FILE, serializeMapFile(model), {silent: true});
    const workspace = createMapWorkspace('/maps', {fs, pollMs: 0});
    workspaces.push(workspace);
    if (opts.open !== false) await workspace.open(FILE);
    const doc = workspace.current()?.doc ?? null!;
    const server = createMcpServer(workspace);
    const client = new Client({name: 'test', version: '1.0.0'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const events: MapEvent[] = [];
    doc?.subscribe((e) => events.push(e));

    /** Calls a tool and returns its parsed JSON; throws the message of a tool error. */
    // oxlint-disable-next-line no-explicit-any
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
        const res = await client.callTool({name, arguments: args});
        const text = (res.content as {type: string; text: string}[])[0].text;
        if (res.isError) throw new Error(text);
        return JSON.parse(text);
    };
    const map = () => toOutline(doc.tree);
    /** Id of the topic at a path (test helper; agents never see ids). */
    const idAt = (...path: string[]) => findByPath(doc.tree, path)[0];
    return {doc, fs, workspace, client, call, events, map, idAt};
}

const plan: Outline = {
    text: 'Plan',
    children: [
        {text: 'Product', children: [{text: 'Risks'}, {text: 'Goals'}]},
        {text: 'Marketing', children: [{text: 'Risks'}]},
    ],
};

describe('MCP tools', () => {
    it('lists the tools; none of them takes a map or topic id', async () => {
        const {client} = await setup();
        const {tools} = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual([
            'add_topics',
            'delete_topics',
            'focus_topic',
            'get_map_info',
            'get_selection',
            'get_topic',
            'group_topics',
            'list_icons',
            'move_topic',
            'replace_map',
            'search_topics',
            'update_topic',
        ]);
        for (const t of tools) {
            expect(t.description?.length).toBeGreaterThan(20);
            expect(JSON.stringify(t.inputSchema)).not.toMatch(/mapId|topicId/);
        }
    });

    it('adds topics under the central topic by default, in one patch per call', async () => {
        const {call, events, map} = await setup();
        const r = await call('add_topics', {topics: [{text: 'Goals', children: [{text: 'Speed'}]}]});
        expect(r.added).toEqual([['Central Topic', 'Goals']]);
        await call('add_topics', {parentName: 'Goals', markdown: '- Quality\n  - Tests'});
        expect(events.map((e) => e.type)).toEqual(['patch', 'patch']);
        expect(map()).toEqual({
            text: 'Central Topic',
            children: [{text: 'Goals', children: [{text: 'Speed'}, {text: 'Quality', children: [{text: 'Tests'}]}]}],
        });
    });

    it('warns about new names that are not unique', async () => {
        const {call} = await setup(plan);
        const r = await call('add_topics', {parentName: 'Marketing', topics: [{text: 'Goals'}]});
        expect(r).toMatchObject({notUniqueNames: ['Goals']});
    });

    it('asks which topic is meant when a name is not unique, and changes nothing', async () => {
        const {call, events} = await setup(plan);
        await expect(call('update_topic', {topicName: 'Risks', text: 'Threats'})).rejects.toThrow(
            'topicName "Risks" is not unique: 2 topics have this text. Which one do you mean? Nothing was changed. ' +
                'Call again with "topicPath" set to one of:\n- ["Plan","Product","Risks"]\n- ["Plan","Marketing","Risks"]',
        );
        await expect(call('add_topics', {parentName: 'Risks', topics: [{text: 'x'}]})).rejects.toThrow(
            /parentName "Risks" is not unique.*"parentPath"/s,
        );
        expect(events).toEqual([]);

        await call('update_topic', {topicPath: ['Plan', 'Marketing', 'Risks'], text: 'Threats'});
        await call('add_topics', {parentPath: ['Product', 'Risks'], topics: [{text: 'Delay'}]});
        const {topic} = await call('get_topic', {topicName: 'Product'});
        expect(topic).toEqual({
            text: 'Product',
            children: [{text: 'Risks', children: [{text: 'Delay'}]}, {text: 'Goals'}],
        });
        expect((await call('get_topic', {topicName: 'Threats'})).path).toEqual(['Plan', 'Marketing', 'Threats']);
    });

    it('searches, moves, groups and deletes by name and path', async () => {
        const {call, map} = await setup(plan);
        expect(await call('search_topics', {query: 'risk'})).toEqual({
            total: 2,
            matches: [
                ['Plan', 'Product', 'Risks'],
                ['Plan', 'Marketing', 'Risks'],
            ],
        });
        await call('move_topic', {topicName: 'Goals', newParentName: 'Plan', index: 0});
        const g = await call('group_topics', {
            topics: [{topicName: 'Marketing'}, {topicName: 'Product'}],
            text: 'Work',
        });
        expect(g.path).toEqual(['Plan', 'Work']);
        expect(map()).toEqual({
            text: 'Plan',
            children: [
                {text: 'Goals'},
                {
                    text: 'Work',
                    children: [
                        {text: 'Marketing', children: [{text: 'Risks'}]},
                        {text: 'Product', children: [{text: 'Risks'}]},
                    ],
                },
            ],
        });
        await expect(call('delete_topics', {topics: [{topicName: 'Risks'}]})).rejects.toThrow(/not unique/);
        const d = await call('delete_topics', {topics: [{topicPath: ['Product', 'Risks']}, {topicName: 'Goals'}]});
        expect(d).toEqual({
            deleted: [
                ['Plan', 'Work', 'Product', 'Risks'],
                ['Plan', 'Goals'],
            ],
            deletedTopicCount: 2,
        });
    });

    it('returns errors with guidance', async () => {
        const {call} = await setup(plan);
        await expect(call('get_topic', {topicName: 'Risk'})).rejects.toThrow(/Topics with similar text/);
        await expect(call('delete_topics', {topics: [{topicName: 'Plan'}]})).rejects.toThrow(/central topic/);
        await expect(call('move_topic', {topicName: 'Product', newParentPath: ['Product', 'Goals']})).rejects.toThrow(
            /under itself/,
        );
        await expect(call('update_topic', {topicName: 'Goals', collapsed: true})).rejects.toThrow(/cannot fold/);
    });

    it('replaces the map from Markdown', async () => {
        const {call, map} = await setup(plan);
        await call('replace_map', {markdown: '- New plan\n  - Now\n  - Later'});
        expect(map()).toEqual({text: 'New plan', children: [{text: 'Now'}, {text: 'Later'}]});
        await call('replace_map', {topics: [{text: 'One'}]});
        expect(map()).toEqual({text: 'New plan', children: [{text: 'One'}]});
    });

    it('reports the selection and focuses topics, unfolding ancestors', async () => {
        const {call, doc, events, idAt} = await setup(plan);
        expect(await call('get_selection')).toEqual({selection: null});
        doc.setSelection('c1', idAt('Marketing', 'Risks'));
        expect((await call('get_selection')).selection.path).toEqual(['Plan', 'Marketing', 'Risks']);

        await call('update_topic', {topicName: 'Marketing', collapsed: true});
        await call('focus_topic', {topicPath: ['Marketing', 'Risks']});
        expect(doc.tree.nodes[idAt('Marketing')].collapsed).toBeUndefined();
        expect(events.at(-1)).toEqual({type: 'focus', topicId: idAt('Marketing', 'Risks')});
    });
});

describe('MCP tools and the map file', () => {
    it('returns from a change tool after the file contains the change', async () => {
        const {call, fs} = await setup(plan);
        await call('add_topics', {parentName: 'Marketing', markdown: '- Q1\n- Q2'});
        expect(fs.text(FILE)).toContain('  - Marketing\n    - Risks\n    - Q1\n    - Q2\n');
    });

    it('reads, writes and removes notes', async () => {
        const {call, fs} = await setup(plan);
        await call('add_topics', {topics: [{text: 'Ideas', note: 'Collected in **May**.'}]});
        expect((await call('get_topic', {topicName: 'Ideas'})).topic).toEqual({
            text: 'Ideas',
            note: 'Collected in **May**.',
        });
        expect(await call('update_topic', {topicPath: ['Product', 'Risks'], note: 'Scope creep.'})).toEqual({
            path: ['Plan', 'Product', 'Risks'],
            collapsed: false,
            note: 'Scope creep.',
        });
        expect(fs.text(FILE)).toContain('# Notes\n\n## Product > Risks\n\nScope creep.\n\n## Ideas\n\nCollected');
        await call('update_topic', {topicName: 'Ideas', note: ''});
        expect((await call('get_topic', {topicName: 'Ideas'})).topic).toEqual({text: 'Ideas'});
        expect(fs.text(FILE)).not.toContain('## Ideas');
    });

    it('reports the file in get_map_info', async () => {
        const {call} = await setup(plan);
        expect(await call('get_map_info')).toEqual({
            path: FILE,
            state: 'clean',
            diagnostics: [],
            writtenAt: null,
            changedOnDiskAt: null,
        });
    });

    it('refuses changes with the diagnostics while the file is invalid, and still reads', async () => {
        const {call, fs, workspace} = await setup(plan);
        fs.writeExternal(FILE, '---\nmindmap: 1\n---\n\n# Map\n\n- Plan\n<<<<<<< HEAD\n');
        await workspace
            .current()!
            .flush()
            .catch(() => {});
        await expect(call('add_topics', {topics: [{text: 'X'}]})).rejects.toThrow(
            `The map file has errors, so changes are paused. Fix the file ${FILE}:\n- line 8: Git conflict marker.`,
        );
        expect((await call('get_map_info')).state).toBe('invalid');
        expect((await call('get_topic', {topicName: 'Marketing'})).path).toEqual(['Plan', 'Marketing']);
    });

    it('answers every map tool with the no-file error while no file is open', async () => {
        const {call} = await setup(plan, {open: false});
        for (const [name, args] of [
            ['get_topic', {topicName: 'Plan'}],
            ['search_topics', {query: 'x'}],
            ['get_selection', {}],
            ['add_topics', {topics: [{text: 'X'}]}],
            ['focus_topic', {topicName: 'Plan'}],
        ] as const) {
            await expect(call(name, args)).rejects.toThrow(NO_FILE_MESSAGE);
        }
        expect(await call('get_map_info')).toEqual({path: null});
    });
});
