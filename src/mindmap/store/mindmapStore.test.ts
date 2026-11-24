import { fromOutline } from '../model/tree';
import { createMindMapStore } from './mindmapStore';

const make = () =>
  createMindMapStore({ tree: fromOutline({ text: 'R', children: [{ text: 'A', children: [{ text: 'A1' }] }, { text: 'B' }] }) });

describe('mind map store', () => {
  it('adds a child, selects it and starts editing', () => {
    const s = make();
    s.getState().addChild();
    const { selectedId, editing, tree } = s.getState();
    expect(tree.nodes[selectedId].parentId).toBe('root');
    expect(editing).toEqual({ id: selectedId, seed: null });
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

  it('navigates using the current layout', () => {
    const s = make();
    s.getState().setLayout('org');
    s.getState().navigate('ArrowDown');
    expect(s.getState().selectedId).toBe('root.0');
  });
});
