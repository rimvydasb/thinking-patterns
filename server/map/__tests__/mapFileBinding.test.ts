import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {toOutline} from '../../../app/mindmap/model/tree';
import type {MindMapTree} from '../../../app/mindmap/model/types';
import type {FileState} from '../../../app/mindmap/sync/protocol';
import {NodeFsPort} from '../fsPort';
import type {MapEvent} from '../mapDocument';
import {openMapFile, type MapFileBinding} from '../mapFileBinding';
import {MemoryFsPort} from '../testing/memoryFsPort';

const FILE = '/maps/plan.map.md';
const file = (...lines: string[]) => ['---', 'mindmap: 1', '---', '', '# Map', '', ...lines, ''].join('\n');
const PLAN = file('- Plan', '  - Goals', '  - Risks');

const bindings: MapFileBinding[] = [];
afterEach(async () => {
    for (const b of bindings.splice(0)) await b.close();
});

async function setup(text: string | null = PLAN, opts: {pollMs?: number} = {}) {
    const fs = new MemoryFsPort();
    fs.mkdirp('/maps');
    if (text !== null) fs.writeExternal(FILE, text, {silent: true});
    const writes: string[] = [];
    const write = fs.writeAtomic.bind(fs);
    fs.writeAtomic = async (p, t) => {
        writes.push(t);
        await write(p, t);
    };
    const binding = await openMapFile(FILE, {fs, pollMs: opts.pollMs ?? 0});
    bindings.push(binding);
    const events: MapEvent[] = [];
    const states: FileState[] = [];
    binding.doc.subscribe((e) => events.push(e));
    binding.subscribe((s) => states.push(s));
    return {fs, binding, doc: binding.doc, writes, events, states};
}

/** Waits until the binding has processed all queued checks and writes. */
const settle = async (b: MapFileBinding) => {
    await b.flush().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    await b.flush().catch(() => {});
};

async function until(check: () => void, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        try {
            check();
            return;
        } catch (e) {
            if (Date.now() > end) throw e;
            await new Promise((r) => setTimeout(r, 10));
        }
    }
}

const texts = (t: MindMapTree) => toOutline(t);
const idOf = (t: MindMapTree, text: string) => Object.values(t.nodes).find((n) => n.text === text)!.id;
const addUnderRoot = (t: MindMapTree, id: string, text: string) => ({
    op: 'add' as const,
    id,
    parentId: t.rootId,
    index: 99,
    text,
});

describe('openMapFile', () => {
    it('loads the file into a document with random ids', async () => {
        const {binding, doc} = await setup();
        expect(texts(doc.tree)).toEqual({text: 'Plan', children: [{text: 'Goals'}, {text: 'Risks'}]});
        expect(doc.tree.rootId).not.toBe('root');
        expect(binding.fileState()).toEqual({
            path: FILE,
            state: 'clean',
            diagnostics: [],
            writtenAt: null,
            changedOnDiskAt: null,
        });
    });

    it('opens an invalid file in the invalid state with the diagnostics', async () => {
        const {binding} = await setup('# Map\n\n- A\n');
        expect(binding.fileState().state).toBe('invalid');
        expect(binding.fileState().diagnostics[0].severity).toBe('error');
    });

    it('creates a new file, and refuses to create one that exists', async () => {
        const fs = new MemoryFsPort();
        fs.mkdirp('/maps');
        const b = await openMapFile('/maps/new.map.md', {fs, pollMs: 0, create: true});
        bindings.push(b);
        expect(fs.text('/maps/new.map.md')).toBe('---\nmindmap: 1\n---\n\n# Map\n\n- Central Topic\n');
        await expect(openMapFile('/maps/new.map.md', {fs, pollMs: 0, create: true})).rejects.toMatchObject({
            code: 'exists',
        });
        await expect(openMapFile('/maps/none.map.md', {fs, pollMs: 0})).rejects.toMatchObject({code: 'not-found'});
    });
});

describe('MapFileBinding writes', () => {
    it('writes a change through, and flush resolves after the write', async () => {
        const {doc, binding, fs, states} = await setup();
        doc.apply([addUnderRoot(doc.tree, 'n1', 'Budget')]);
        expect(binding.fileState().state).toBe('writing');
        await binding.flush();
        expect(fs.text(FILE)).toBe(file('- Plan', '  - Goals', '  - Risks', '  - Budget'));
        expect(binding.fileState().state).toBe('clean');
        expect(binding.fileState().writtenAt).not.toBeNull();
        expect(states.map((s) => s.state)).toEqual(['writing', 'clean']);
    });

    it('coalesces changes during a running write into one more write', async () => {
        const {doc, binding, writes} = await setup();
        for (let i = 0; i < 5; i++) doc.apply([addUnderRoot(doc.tree, `n${i}`, `T${i}`)]);
        await binding.flush();
        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('  - T4\n');
    });

    it('does not ingest its own writes (echo suppressed by hash)', async () => {
        const {doc, binding, events} = await setup();
        doc.apply([addUnderRoot(doc.tree, 'n1', 'Budget')]);
        await settle(binding);
        expect(events).toHaveLength(1);
        expect(binding.fileState().changedOnDiskAt).toBeNull();
    });

    it('does not write a change of the folded state only (D4)', async () => {
        const {doc, binding, writes} = await setup(file('- Plan', '  - Goals', '    - Speed'));
        doc.apply([{op: 'setCollapsed', id: idOf(doc.tree, 'Goals'), collapsed: true}]);
        await settle(binding);
        expect(writes).toEqual([]);
        expect(binding.fileState().state).toBe('clean');
    });

    it('writes notes and keeps frontmatter, other sections and orphan notes', async () => {
        const text = [
            '---',
            'mindmap: 1',
            'owner: me',
            '---',
            '',
            '# Map',
            '',
            '- Plan',
            '',
            '# Notes',
            '',
            '## Gone',
            '',
            'Orphan.',
            '',
            '# Links',
            '',
            'x',
            '',
        ].join('\n');
        const {doc, binding, fs} = await setup(text);
        doc.apply([{op: 'setNote', id: doc.tree.rootId, note: 'Root note.'}]);
        await binding.flush();
        expect(fs.text(FILE)).toBe(
            '---\nmindmap: 1\nowner: me\n---\n\n# Map\n\n- Plan\n\n# Notes\n\n## Plan\n\nRoot note.\n\n## Gone\n\nOrphan.\n\n# Links\n\nx\n',
        );
    });
});

describe('MapFileBinding change detection', () => {
    it('applies a file change as one patch without origin, and does not write it back', async () => {
        const {fs, doc, binding, events, writes} = await setup();
        const risks = idOf(doc.tree, 'Risks');
        fs.writeExternal(FILE, file('- Plan', '  - Objectives', '  - Risks', '  - Budget'));
        await settle(binding);
        expect(texts(doc.tree)).toEqual({
            text: 'Plan',
            children: [{text: 'Objectives'}, {text: 'Risks'}, {text: 'Budget'}],
        });
        expect(idOf(doc.tree, 'Risks')).toBe(risks);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({type: 'patch'});
        expect('origin' in events[0]).toBe(false);
        expect(writes).toEqual([]);
        expect(binding.fileState().changedOnDiskAt).not.toBeNull();
    });

    it('ignores a touch (new mtime, same content)', async () => {
        const {fs, binding, events, states} = await setup();
        fs.touch(FILE);
        await settle(binding);
        expect(events).toEqual([]);
        expect(states).toEqual([]);
    });

    it('does not rewrite a hand-formatted file after a change with no in-memory change (D8)', async () => {
        const {fs, binding, writes} = await setup();
        const hand =
            '---\r\nmindmap: 1\r\n---\r\n\r\n# Map\r\n\r\n* Plan\r\n    * Goals\r\n    * Risks\r\n    * New\r\n';
        fs.writeExternal(FILE, hand);
        await settle(binding);
        expect(writes).toEqual([]);
        expect(fs.text(FILE)).toBe(hand);
    });

    it('keeps both an external change and an unwritten in-memory change', async () => {
        const {fs, doc, binding} = await setup();
        // The in-memory change is queued, and the editor saves before the write starts.
        doc.apply([addUnderRoot(doc.tree, 'n1', 'From GUI')]);
        fs.writeExternal(FILE, file('- Plan', '  - Goals', '  - Risks', '  - From editor'), {silent: true});
        await binding.flush();
        expect(fs.text(FILE)).toBe(file('- Plan', '  - Goals', '  - Risks', '  - From editor', '  - From GUI'));
        expect(texts(doc.tree).children!.map((c) => c.text)).toEqual(['Goals', 'Risks', 'From editor', 'From GUI']);
    });

    it('detects a change by the poll when the watch misses it', async () => {
        const {fs, doc} = await setup(PLAN, {pollMs: 10});
        fs.watchEnabled = false;
        fs.writeExternal(FILE, file('- Plan', '  - Polled'));
        await until(() => expect(texts(doc.tree)).toEqual({text: 'Plan', children: [{text: 'Polled'}]}));
    });

    it('detects a same-size change with an equal mtime on a watch event (hash, not stamp)', async () => {
        const {fs, doc, binding} = await setup();
        const {mtimeMs} = (await fs.stat(FILE))!;
        fs.writeExternal(FILE, PLAN.replace('Goals', 'Gools'), {mtimeMs});
        await settle(binding);
        expect(texts(doc.tree).children![0].text).toBe('Gools');
    });
});

describe('MapFileBinding invalid and missing files', () => {
    it('pauses writes while the file is invalid, and resumes them with the in-memory changes kept', async () => {
        const {fs, doc, binding} = await setup();
        const broken = `${PLAN}<<<<<<< HEAD\n`;
        fs.writeExternal(FILE, broken);
        await settle(binding);
        expect(binding.fileState().state).toBe('invalid');
        expect(binding.fileState().diagnostics[0]).toMatchObject({severity: 'error', line: 10});

        doc.apply([addUnderRoot(doc.tree, 'n1', 'While broken')]);
        await expect(binding.flush()).rejects.toThrow('The map file has errors, so changes are paused.');
        expect(fs.text(FILE)).toBe(broken);

        fs.writeExternal(FILE, file('- Plan', '  - Goals', '  - Risks', '  - Fixed'));
        await settle(binding);
        expect(binding.fileState().state).toBe('clean');
        expect(fs.text(FILE)).toBe(file('- Plan', '  - Goals', '  - Risks', '  - Fixed', '  - While broken'));
    });

    it('goes to missing when the file is deleted, and back to clean when it returns', async () => {
        const {fs, doc, binding} = await setup();
        fs.remove(FILE);
        await settle(binding);
        expect(binding.fileState().state).toBe('missing');
        doc.apply([addUnderRoot(doc.tree, 'n1', 'Offline')]);
        await expect(binding.flush()).rejects.toThrow('does not exist any more');
        expect(fs.text(FILE)).toBeUndefined();

        fs.writeExternal(FILE, PLAN);
        await settle(binding);
        expect(binding.fileState().state).toBe('clean');
        expect(fs.text(FILE)).toBe(file('- Plan', '  - Goals', '  - Risks', '  - Offline'));
    });

    it('writes the app version to the file in any state (forceWrite)', async () => {
        const {fs, doc, binding} = await setup();
        fs.writeExternal(FILE, 'garbage\n');
        await settle(binding);
        expect(binding.fileState().state).toBe('invalid');
        await binding.forceWrite();
        expect(fs.text(FILE)).toBe(PLAN);
        expect(binding.fileState()).toMatchObject({state: 'clean', diagnostics: []});
        expect(texts(doc.tree).children).toHaveLength(2);
    });
});

describe('MapFileBinding with the real file system', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'map-binding-'));
    });
    afterEach(async () => {
        await rm(dir, {recursive: true, force: true});
    });

    it('detects an atomic rename save by the watch within 1500 ms, and writes atomically', async () => {
        const target = path.join(dir, 'plan.map.md');
        await writeFile(target, PLAN);
        // The poll is off, so only fs.watch can see the change (Assumption in D5).
        const binding = await openMapFile(target, {fs: new NodeFsPort(), pollMs: 0});
        bindings.push(binding);

        const tmp = path.join(dir, '.plan.map.md.swp');
        await writeFile(tmp, file('- Plan', '  - Saved by editor'));
        const savedAt = Date.now();
        await rename(tmp, target);
        await until(
            () => expect(texts(binding.doc.tree).children).toEqual([{text: 'Saved by editor'}]),
            1500 - (Date.now() - savedAt),
        );

        binding.doc.apply([addUnderRoot(binding.doc.tree, 'n1', 'From app')]);
        await binding.flush();
        expect(await readFile(target, 'utf8')).toBe(file('- Plan', '  - Saved by editor', '  - From app'));
    });
});
