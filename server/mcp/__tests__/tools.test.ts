import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {fromOutline, toOutline} from '../../../app/mindmap/model/tree';
import type {Outline} from '../../../app/mindmap/model/types';
import {MapDocument, type MapEvent} from '../../map/mapDocument';
import {createMcpServer} from '../tools';

async function setup(outline?: Outline) {
    const doc = new MapDocument(outline ? fromOutline(outline) : undefined);
    const server = createMcpServer(doc);
    const client = new Client({name: 'test', version: '1.0.0'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const events: MapEvent[] = [];
    doc.subscribe((e) => events.push(e));

    /** Calls a tool and returns its parsed JSON; throws the message of a tool error. */
    // oxlint-disable-next-line no-explicit-any
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
        const res = await client.callTool({name, arguments: args});
        const text = (res.content as {type: string; text: string}[])[0].text;
        if (res.isError) throw new Error(text);
        return JSON.parse(text);
    };
    const map = () => toOutline(doc.tree);
    return {doc, client, call, events, map};
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
            'get_selection',
            'get_topic',
            'group_topics',
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
        const {call, doc, events} = await setup(plan);
        expect(await call('get_selection')).toEqual({selection: null});
        doc.setSelection('c1', 'root.1.0');
        expect((await call('get_selection')).selection.path).toEqual(['Plan', 'Marketing', 'Risks']);

        await call('update_topic', {topicName: 'Marketing', collapsed: true});
        await call('focus_topic', {topicPath: ['Marketing', 'Risks']});
        expect(doc.tree.nodes['root.1'].collapsed).toBeUndefined();
        expect(events.at(-1)).toEqual({type: 'focus', topicId: 'root.1.0'});
    });
});
