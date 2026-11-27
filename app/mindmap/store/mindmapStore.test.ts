import {applyOps} from '../model/ops';
import {fromOutline} from '../model/tree';
import {createMindMapStore} from './mindmapStore';

const make = () =>
    createMindMapStore({
        tree: fromOutline({text: 'R', children: [{text: 'A', children: [{text: 'A1'}]}, {text: 'B'}]}),
    });

describe('mind map store', () => {
    it('adds a child, selects it and starts editing', () => {
        const s = make();
        s.getState().addChild();
        const {selectedId, editing, tree} = s.getState();
        expect(tree.nodes[selectedId].parentId).toBe('root');
        expect(editing).toEqual({id: selectedId, seed: null});
    });

    it('commits edits and ignores blank text', () => {
        const s = make();
        s.getState().startEditing('root.1');
        s.getState().commitEdit('Bee  ');
        expect(s.getState().tree.nodes['root.1'].text).toBe('Bee');
        s.getState().startEditing('root.1');
        s.getState().commitEdit('   ');
        expect(s.getState().tree.nodes['root.1'].text).toBe('Bee');
        expect(s.getState().editing).toBeNull();
    });

    it('undoes and redoes structural changes', () => {
        const s = make();
        s.getState().select('root.0');
        s.getState().deleteSelected();
        expect(s.getState().tree.nodes['root.0']).toBeUndefined();
        expect(s.getState().selectedId).toBe('root.1');
        s.getState().undo();
        expect(s.getState().tree.nodes['root.0.0']).toBeDefined();
        s.getState().redo();
        expect(s.getState().tree.nodes['root.0']).toBeUndefined();
    });

    it('moves the selection out of a collapsed subtree', () => {
        const s = make();
        s.getState().select('root.0.0');
        s.getState().toggleCollapse('root.0');
        expect(s.getState().selectedId).toBe('root.0');
    });

    it('does not record history for no-op changes', () => {
        const s = make();
        s.getState().select('root');
        s.getState().deleteSelected();
        s.getState().toggleCollapse('root.1');
        expect(s.getState().past).toHaveLength(0);
    });

    it('moves a topic under another one as an undoable step', () => {
        const s = make();
        s.getState().moveTopic('root.1', 'root.0');
        const {tree, selectedId} = s.getState();
        expect(tree.nodes['root.0'].children).toEqual(['root.0.0', 'root.1']);
        expect(tree.nodes['root.1'].parentId).toBe('root.0');
        expect(selectedId).toBe('root.1');
        s.getState().undo();
        expect(s.getState().tree.nodes['root'].children).toEqual(['root.0', 'root.1']);
    });

    it('refuses to move a topic into its own subtree or onto its current parent', () => {
        const s = make();
        s.getState().moveTopic('root.0', 'root.0.0');
        s.getState().moveTopic('root.0', 'root');
        expect(s.getState().past).toHaveLength(0);
    });

    it('toggles topics in and out of a multi-selection', () => {
        const s = make();
        s.getState().select('root.0');
        s.getState().toggleSelect('root.1');
        expect(s.getState().selectedIds).toEqual(['root.0', 'root.1']);
        expect(s.getState().selectedId).toBe('root.1');
        s.getState().toggleSelect('root.1');
        expect(s.getState().selectedIds).toEqual(['root.0']);
        expect(s.getState().selectedId).toBe('root.0');
        // The last selected topic cannot be toggled off.
        s.getState().toggleSelect('root.0');
        expect(s.getState().selectedIds).toEqual(['root.0']);
    });

    it('resets the multi-selection when the selection moves another way', () => {
        const s = make();
        s.getState().select('root.0');
        s.getState().toggleSelect('root.1');
        s.getState().navigate('ArrowRight'); // root.1 is on the left: back to the root
        expect(s.getState().selectedIds).toEqual(['root']);
    });

    it('unselects all topics and ignores topic actions until selected again', () => {
        const s = make();
        s.getState().select('root.0');
        s.getState().toggleSelect('root.1');
        s.getState().deselect();
        expect(s.getState().selectedIds).toEqual([]);
        s.getState().addChild();
        s.getState().deleteSelected();
        s.getState().toggleCollapse();
        s.getState().startEditing();
        expect(s.getState().past).toHaveLength(0);
        expect(s.getState().editing).toBeNull();
        s.getState().setLayout('org');
        s.getState().undo();
        expect(s.getState().selectedIds).toEqual([]);
        s.getState().reselect();
        expect(s.getState().selectedIds).toEqual(['root.1']);
        s.getState().deselect();
        s.getState().select('root.0');
        expect(s.getState().selectedIds).toEqual(['root.0']);
    });

    it('drops removed and hidden topics from the multi-selection', () => {
        const s = make();
        s.getState().select('root.1');
        s.getState().toggleSelect('root.0.0');
        s.getState().toggleSelect('root.0');
        s.getState().toggleCollapse('root.0');
        expect(s.getState().selectedIds).toEqual(['root.1', 'root.0']);
    });

    it('moves several topics in map order as one undo step', () => {
        const s = createMindMapStore({
            tree: fromOutline({text: 'R', children: [{text: 'A', children: [{text: 'A1'}]}, {text: 'B'}, {text: 'C'}]}),
        });
        s.getState().moveTopics(['root.2', 'root.0', 'root.0.0'], 'root.1');
        const {tree} = s.getState();
        expect(tree.nodes['root.1'].children).toEqual(['root.0', 'root.2']);
        expect(tree.nodes['root.0'].children).toEqual(['root.0.0']);
        expect(s.getState().past).toHaveLength(1);
        s.getState().undo();
        expect(s.getState().tree.nodes['root'].children).toEqual(['root.0', 'root.1', 'root.2']);
    });

    it('keeps the layout in the map, as one undo step', () => {
        const s = make();
        s.getState().setLayout('logic');
        expect(s.getState().tree.layout).toBe('logic');
        s.getState().setLayout('logic');
        expect(s.getState().past).toHaveLength(1);
        s.getState().undo();
        expect(s.getState().tree.layout).toBeUndefined();
    });

    it('navigates using the current layout', () => {
        const s = make();
        s.getState().setLayout('org');
        s.getState().navigate('ArrowDown');
        expect(s.getState().selectedId).toBe('root.0');
    });
});

describe('remote changes', () => {
    it('apply without entering the undo history and keep local undo working', () => {
        const s = make();
        s.getState().select('root.1');
        s.getState().startEditing('root.1');
        s.getState().commitEdit('Bee'); // local edit
        const remote = [{op: 'add' as const, id: 'agent', parentId: 'root', index: 0, text: 'From agent'}];
        s.getState().applyRemote(applyOps(s.getState().tree, remote).tree, remote);
        expect(s.getState().tree.nodes.agent.text).toBe('From agent');

        s.getState().undo(); // reverts only the local edit
        expect(s.getState().tree.nodes['root.1'].text).toBe('B');
        expect(s.getState().tree.nodes.agent).toBeDefined();
        expect(s.getState().past).toHaveLength(0);
    });

    it('fixes the selection and the editor when the topic disappears', () => {
        const s = make();
        s.getState().startEditing('root.0.0');
        const ops = [{op: 'remove' as const, id: 'root.0'}];
        s.getState().applyRemote(applyOps(s.getState().tree, ops).tree, ops);
        expect(s.getState().selectedId).toBe('root');
        expect(s.getState().editing).toBeNull();
    });

    it('clears the history when replacing the content', () => {
        const s = make();
        s.getState().addChild();
        s.getState().applyRemote(fromOutline({text: 'New'}), null);
        expect(s.getState().past).toEqual([]);
        expect(s.getState().tree.nodes.root.text).toBe('New');
    });
});
