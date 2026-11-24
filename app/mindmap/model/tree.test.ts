import * as T from './tree';
import type {MindMapTree} from './types';

const sample = (): MindMapTree =>
    T.fromOutline({
        text: 'Root',
        children: [
            {text: 'A', children: [{text: 'A1'}, {text: 'A2', children: [{text: 'A2a'}]}]},
            {text: 'B'},
            {text: 'C', children: [{text: 'C1'}]},
        ],
    });

const texts = (t: MindMapTree, id: string) => T.getNode(t, id).children.map((c) => t.nodes[c].text);

describe('outline conversion', () => {
    it('round-trips through fromOutline/toOutline', () => {
        const outline = {text: 'R', children: [{text: 'x', collapsed: true, children: [{text: 'y'}]}]};
        expect(T.toOutline(T.fromOutline(outline))).toEqual(outline);
    });

    it('assigns deterministic ids', () => {
        expect(Object.keys(sample().nodes)).toContain('root.0.1.0');
    });
});

describe('queries', () => {
    const t = sample();
    it('computes depth, path and branch', () => {
        expect(T.depthOf(t, 'root')).toBe(0);
        expect(T.depthOf(t, 'root.0.1.0')).toBe(3);
        expect(T.pathTo(t, 'root.0.1')).toEqual(['root', 'root.0', 'root.0.1']);
        expect(T.branchIndex(t, 'root.2.0')).toBe(2);
        expect(T.branchIndex(t, 'root')).toBe(-1);
    });

    it('lists visible ids, skipping collapsed subtrees', () => {
        const c = T.setCollapsed(t, 'root.0', true);
        expect(T.visibleIds(c)).toEqual(['root', 'root.0', 'root.1', 'root.2', 'root.2.0']);
        expect(T.hiddenDescendantCount(c, 'root.0')).toBe(3);
    });

    it('splits root children for the balanced layout', () => {
        expect(T.splitBalanced([1, 2, 3])).toEqual({right: [1, 2], left: [3]});
        expect(T.splitBalanced([1, 2, 3, 4])).toEqual({right: [1, 2], left: [3, 4]});
        expect(T.splitBalanced([])).toEqual({right: [], left: []});
    });

    it('knows on which side a node grows', () => {
        expect(T.sideOf(t, 'root.0.1', 'mindmap')).toBe('right');
        expect(T.sideOf(t, 'root.2.0', 'mindmap')).toBe('left');
        expect(T.sideOf(t, 'root.2.0', 'logic')).toBe('right');
        expect(T.sideOf(t, 'root.2.0', 'org')).toBe('down');
    });
});

describe('mutations', () => {
    it('adds a child with a default text and expands the parent', () => {
        const t = T.setCollapsed(sample(), 'root.0', true);
        const r = T.addChild(t, 'root.0', {id: 'new'});
        expect(texts(r.tree, 'root.0')).toEqual(['A1', 'A2', 'Subtopic']);
        expect(r.tree.nodes['root.0'].collapsed).toBe(false);
        expect(r.tree.nodes.new.parentId).toBe('root.0');
        expect(T.addChild(t, 'root', {id: 'm'}).tree.nodes.m.text).toBe('Main Topic');
    });

    it('adds siblings before and after', () => {
        const t = sample();
        const after = T.addSibling(t, 'root.1', 'after', {text: 'B+'});
        expect(texts(after.tree, 'root')).toEqual(['A', 'B', 'B+', 'C']);
        const before = T.addSibling(t, 'root.1', 'before', {text: 'B-'});
        expect(texts(before.tree, 'root')).toEqual(['A', 'B-', 'B', 'C']);
    });

    it('adds a child when asked for a sibling of the root', () => {
        const r = T.addSibling(sample(), 'root', 'after', {text: 'D'});
        expect(texts(r.tree, 'root')).toEqual(['A', 'B', 'C', 'D']);
    });

    it('inserts a parent topic', () => {
        const r = T.addParent(sample(), 'root.1', {id: 'p', text: 'P'});
        expect(texts(r.tree, 'root')).toEqual(['A', 'P', 'C']);
        expect(texts(r.tree, 'p')).toEqual(['B']);
        expect(r.tree.nodes['root.1'].parentId).toBe('p');
    });

    it('removes a subtree and suggests the next selection', () => {
        const t = sample();
        const r = T.removeNode(t, 'root.0');
        expect(texts(r.tree, 'root')).toEqual(['B', 'C']);
        expect(r.tree.nodes['root.0.1.0']).toBeUndefined();
        expect(r.nextSelection).toBe('root.1');
        expect(T.removeNode(t, 'root.2').nextSelection).toBe('root.1');
        expect(T.removeNode(t, 'root.2.0').nextSelection).toBe('root.2');
    });

    it('never removes the root', () => {
        const t = sample();
        expect(T.removeNode(t, 'root').tree).toBe(t);
    });

    it('does not mutate the input tree', () => {
        const t = sample();
        const snapshot = JSON.stringify(t);
        T.addChild(t, 'root');
        T.removeNode(t, 'root.0');
        T.updateText(t, 'root', 'X');
        T.moveAmongSiblings(t, 'root.0', 1);
        expect(JSON.stringify(t)).toBe(snapshot);
    });

    it('returns the same tree when nothing changes', () => {
        const t = sample();
        expect(T.updateText(t, 'root', 'Root')).toBe(t);
        expect(T.setCollapsed(t, 'root.1', true)).toBe(t); // leaf cannot collapse
        expect(T.moveAmongSiblings(t, 'root.0', -1)).toBe(t);
    });

    it('moves among siblings (clamped)', () => {
        const t = T.moveAmongSiblings(sample(), 'root.0', 5);
        expect(texts(t, 'root')).toEqual(['B', 'C', 'A']);
    });

    it('re-parents nodes and refuses cycles', () => {
        const t = sample();
        const moved = T.moveNode(t, 'root.1', 'root.2', 0);
        expect(texts(moved, 'root.2')).toEqual(['B', 'C1']);
        expect(moved.nodes['root.1'].parentId).toBe('root.2');
        expect(T.moveNode(t, 'root.0', 'root.0.1.0')).toBe(t);
    });
});

describe('navigate', () => {
    const t = sample();
    it('logic chart: right = child, left = parent, up/down = siblings', () => {
        expect(T.navigate(t, 'root', 'ArrowRight', 'logic')).toBe('root.0');
        expect(T.navigate(t, 'root.0', 'ArrowRight', 'logic')).toBe('root.0.0');
        expect(T.navigate(t, 'root.0.0', 'ArrowLeft', 'logic')).toBe('root.0');
        expect(T.navigate(t, 'root.0', 'ArrowDown', 'logic')).toBe('root.1');
        expect(T.navigate(t, 'root.0', 'ArrowUp', 'logic')).toBe('root.0');
        expect(T.navigate(t, 'root', 'ArrowLeft', 'logic')).toBe('root');
    });

    it('mind map: left side is mirrored and siblings stay on their side', () => {
        expect(T.navigate(t, 'root', 'ArrowLeft', 'mindmap')).toBe('root.2');
        expect(T.navigate(t, 'root.2', 'ArrowLeft', 'mindmap')).toBe('root.2.0');
        expect(T.navigate(t, 'root.2.0', 'ArrowRight', 'mindmap')).toBe('root.2');
        expect(T.navigate(t, 'root.1', 'ArrowDown', 'mindmap')).toBe('root.1');
        expect(T.navigate(t, 'root.2', 'ArrowUp', 'mindmap')).toBe('root.2');
    });

    it('org chart: down = child, up = parent, left/right = siblings', () => {
        expect(T.navigate(t, 'root', 'ArrowDown', 'org')).toBe('root.0');
        expect(T.navigate(t, 'root.0', 'ArrowRight', 'org')).toBe('root.1');
        expect(T.navigate(t, 'root.1', 'ArrowLeft', 'org')).toBe('root.0');
        expect(T.navigate(t, 'root.1', 'ArrowUp', 'org')).toBe('root');
    });

    it('does not enter collapsed topics', () => {
        const c = T.setCollapsed(t, 'root.0', true);
        expect(T.navigate(c, 'root.0', 'ArrowRight', 'logic')).toBe('root.0');
    });
});
