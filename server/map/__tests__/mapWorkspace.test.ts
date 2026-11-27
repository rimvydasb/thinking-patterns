import {createMapWorkspace} from '../mapWorkspace';
import {MemoryFsPort} from '../testing/memoryFsPort';

const text = (root: string) => `---\nmindmap: 1\n---\n\n# Map\n\n- ${root}\n`;

function setup() {
    const fs = new MemoryFsPort();
    fs.writeExternal('/maps/a.map.md', text('A'), {silent: true});
    fs.writeExternal('/maps/b.map.md', text('B'), {silent: true});
    fs.writeExternal('/elsewhere/c.map.md', text('C'), {silent: true});
    const workspace = createMapWorkspace('/maps', {fs, pollMs: 0});
    const opened: (string | null)[] = [];
    workspace.subscribe((b) => opened.push(b ? b.fileState().path : null));
    return {fs, workspace, opened};
}

describe('MapWorkspace', () => {
    it('starts with no file, opens a file and switches to another one', async () => {
        const {workspace, opened} = setup();
        expect(workspace.current()).toBeNull();
        await workspace.open('/maps/a.map.md');
        const first = workspace.current()!;
        await workspace.open('/maps/b.map.md');
        expect(workspace.current()).not.toBe(first);
        expect(workspace.current()!.doc.tree.nodes[workspace.current()!.doc.tree.rootId].text).toBe('B');
        expect(opened).toEqual(['/maps/a.map.md', '/maps/b.map.md']);
        await workspace.close();
        expect(opened.at(-1)).toBeNull();
    });

    it('changes nothing when the open file is opened again', async () => {
        const {workspace, opened} = setup();
        await workspace.open('/maps/a.map.md');
        const first = workspace.current();
        expect(await workspace.open('/maps/a.map.md')).toMatchObject({path: '/maps/a.map.md'});
        expect(workspace.current()).toBe(first);
        expect(opened).toHaveLength(1);
        await workspace.close();
    });

    it('flushes the current file before it switches', async () => {
        const {fs, workspace} = setup();
        await workspace.open('/maps/a.map.md');
        const {doc} = workspace.current()!;
        doc.apply([{op: 'add', id: 'x', parentId: doc.tree.rootId, index: 0, text: 'Unsaved'}]);
        await workspace.open('/maps/b.map.md');
        expect(fs.text('/maps/a.map.md')).toBe(`${text('A')}  - Unsaved\n`);
        await workspace.close();
    });

    it('keeps the open file when a create fails', async () => {
        const {workspace} = setup();
        await workspace.open('/maps/a.map.md');
        await expect(workspace.open('/maps/b.map.md', {create: true})).rejects.toMatchObject({status: 409});
        expect(workspace.current()!.fileState().path).toBe('/maps/a.map.md');
        await workspace.close();
    });

    it('checks the root and the suffix, except for trusted paths', async () => {
        const {workspace} = setup();
        await expect(workspace.open('/elsewhere/c.map.md')).rejects.toMatchObject({status: 400});
        await expect(workspace.open('/maps/../elsewhere/c.map.md')).rejects.toMatchObject({status: 400});
        await expect(workspace.open('/maps/missing.map.md')).rejects.toMatchObject({status: 404});
        await expect(workspace.open('/maps/a.txt')).rejects.toMatchObject({status: 400});
        await expect(workspace.open('/maps/.md', {create: true})).rejects.toMatchObject({status: 400});
        await expect(workspace.open('/maps/.map.md', {create: true})).rejects.toMatchObject({status: 400});
        await expect(workspace.listDir('/elsewhere')).rejects.toMatchObject({status: 400});
        await workspace.open('/elsewhere/c.map.md', {trusted: true});
        expect(workspace.current()!.fileState().path).toBe('/elsewhere/c.map.md');
        await workspace.close();
    });

    it('lists and opens any Markdown file, not only .map.md', async () => {
        const {fs, workspace} = setup();
        fs.writeExternal('/maps/notes.md', text('Notes'), {silent: true});
        fs.writeExternal('/maps/Ideas.markdown', text('Ideas'), {silent: true});
        fs.writeExternal('/maps/todo.txt', 'x', {silent: true});
        fs.writeExternal('/maps/.hidden.md', 'x', {silent: true});
        const listing = await workspace.listDir();
        expect(listing.entries.map((e) => e.name)).toEqual(['a.map.md', 'b.map.md', 'Ideas.markdown', 'notes.md']);
        await workspace.open('/maps/notes.md');
        expect(workspace.current()!.doc.tree.nodes[workspace.current()!.doc.tree.rootId].text).toBe('Notes');
        fs.writeExternal('/maps/readme.md', '# Readme\n', {silent: true});
        await expect(workspace.open('/maps/readme.md')).rejects.toMatchObject({status: 400});
        expect(workspace.current()!.fileState().path).toBe('/maps/notes.md');
        await workspace.open('/maps/plan.md', {create: true});
        expect(fs.text('/maps/plan.md')).toBe(text('Central Topic'));
        await workspace.close();
    });
});
