import {applyOp, applyOps, diffTrees, outlineToOps, type MapOp} from './ops';
import * as T from './tree';
import type {MindMapTree, NodeId} from './types';

const base = () =>
    T.fromOutline({
        text: 'R',
        children: [
            {text: 'A', children: [{text: 'A1'}, {text: 'A2'}]},
            {text: 'B'},
            {text: 'C', children: [{text: 'C1'}]},
        ],
    });

/** Structural view used for equality: ids, texts, order, folding. */
const shape = (t: MindMapTree, id: NodeId = t.rootId): unknown => {
    const n = t.nodes[id];
    return [id, n.text, !!n.collapsed, n.note ?? '', n.children.map((c) => shape(t, c))];
};

function consistent(t: MindMapTree) {
    for (const n of Object.values(t.nodes)) {
        for (const c of n.children) expect(t.nodes[c].parentId).toBe(n.id);
        if (n.parentId !== null) expect(t.nodes[n.parentId].children).toContain(n.id);
    }
    expect(T.subtreeIds(t, t.rootId).length).toBe(Object.keys(t.nodes).length);
}

describe('applyOp', () => {
    it('adds a leaf at a clamped index', () => {
        const t = applyOp(base(), {op: 'add', id: 'x', parentId: 'root', index: 99, text: 'X'});
        expect(t.nodes.root.children).toEqual(['root.0', 'root.1', 'root.2', 'x']);
        expect(t.nodes.x).toEqual({id: 'x', text: 'X', parentId: 'root', children: []});
    });

    it('skips ops that do not fit', () => {
        const t = base();
        const skipped: MapOp[] = [
            {op: 'add', id: 'root.0', parentId: 'root', index: 0, text: 'dup'},
            {op: 'add', id: 'y', parentId: 'missing', index: 0, text: 'Y'},
            {op: 'remove', id: 'root'},
            {op: 'remove', id: 'missing'},
            {op: 'move', id: 'root.0', parentId: 'root.0.1', index: 0},
            {op: 'move', id: 'root', parentId: 'root.1', index: 0},
            {op: 'setText', id: 'missing', text: 'x'},
            {op: 'setText', id: 'root.1', text: 'B'},
        ];
        for (const op of skipped) expect(applyOp(t, op)).toBe(t);
    });

    it('removes a whole subtree', () => {
        const t = applyOp(base(), {op: 'remove', id: 'root.0'});
        expect(Object.keys(t.nodes).sort()).toEqual(['root', 'root.1', 'root.2', 'root.2.0']);
        consistent(t);
    });

    it('moves within the same parent using the final index', () => {
        const t = applyOp(base(), {op: 'move', id: 'root.0', parentId: 'root', index: 2});
        expect(t.nodes.root.children).toEqual(['root.1', 'root.2', 'root.0']);
    });

    it('moves to another parent', () => {
        const t = applyOp(base(), {op: 'move', id: 'root.1', parentId: 'root.0', index: 1});
        expect(t.nodes['root.0'].children).toEqual(['root.0.0', 'root.1', 'root.0.1']);
        consistent(t);
    });

    it('sets and clears the collapsed flag', () => {
        const folded = applyOp(base(), {op: 'setCollapsed', id: 'root.0', collapsed: true});
        expect(folded.nodes['root.0'].collapsed).toBe(true);
        expect(
            'collapsed' in applyOp(folded, {op: 'setCollapsed', id: 'root.0', collapsed: false}).nodes['root.0'],
        ).toBe(false);
    });

    it('sets and removes a note', () => {
        const noted = applyOp(base(), {op: 'setNote', id: 'root.1', note: 'Some **Markdown**'});
        expect(noted.nodes['root.1'].note).toBe('Some **Markdown**');
        expect(applyOp(noted, {op: 'setNote', id: 'root.1', note: 'Some **Markdown**'})).toBe(noted);
        expect('note' in applyOp(noted, {op: 'setNote', id: 'root.1', note: ''}).nodes['root.1']).toBe(false);
    });

    it('reports which ops applied', () => {
        const r = applyOps(base(), [
            {op: 'remove', id: 'root.0'},
            {op: 'setText', id: 'root.0.0', text: 'gone'},
        ]);
        expect(r.applied).toEqual([{op: 'remove', id: 'root.0'}]);
    });
});

describe('outlineToOps', () => {
    it('creates nested adds with fresh ids', () => {
        let n = 0;
        const {ops, ids} = outlineToOps(
            [{text: 'X', collapsed: true, children: [{text: 'X1'}]}, {text: 'Y'}],
            'root',
            1,
            () => `id${++n}`,
        );
        expect(ids).toEqual(['id1', 'id3']);
        const t = applyOps(base(), ops).tree;
        expect(t.nodes.root.children).toEqual(['root.0', 'id1', 'id3', 'root.1', 'root.2']);
        expect(t.nodes.id1).toMatchObject({text: 'X', collapsed: true, children: ['id2']});
    });
});

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number) {
    return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
}

function randomEdit(t: MindMapTree, r: () => number): MindMapTree {
    const ids = Object.keys(t.nodes);
    const pick = () => ids[Math.floor(r() * ids.length)];
    switch (Math.floor(r() * 8)) {
        case 7: {
            const id = pick();
            return {...t, nodes: {...t.nodes, [id]: {...t.nodes[id], note: r() < 0.3 ? undefined : `n${r()}`}}};
        }
        case 0:
            return T.addChild(t, pick(), {text: `t${Math.floor(r() * 1000)}`}).tree;
        case 1:
            return T.addSibling(t, pick(), r() < 0.5 ? 'before' : 'after').tree;
        case 2:
            return T.removeNode(t, pick()).tree;
        case 3:
            return T.moveNode(t, pick(), pick(), Math.floor(r() * 3));
        case 4:
            return T.moveAmongSiblings(t, pick(), r() < 0.5 ? -1 : 2);
        case 5:
            return T.toggleCollapsed(t, pick());
        default:
            return T.addParent(t, pick()).tree;
    }
}

describe('diffTrees', () => {
    it('returns no ops for equal trees', () => {
        const t = base();
        expect(diffTrees(t, t)).toEqual([]);
        expect(diffTrees(t, base())).toEqual([]);
    });

    it('handles swapping a parent and its child', () => {
        const from = T.fromOutline({text: 'R', children: [{text: 'X', children: [{text: 'Y'}]}]});
        const to: MindMapTree = {
            rootId: 'root',
            nodes: {
                root: {id: 'root', text: 'R', parentId: null, children: ['root.0.0']},
                'root.0.0': {id: 'root.0.0', text: 'Y', parentId: 'root', children: ['root.0']},
                'root.0': {id: 'root.0', text: 'X', parentId: 'root.0.0', children: []},
            },
        };
        expect(shape(applyOps(from, diffTrees(from, to)).tree)).toEqual(shape(to));
    });

    it('emits setNote for note changes', () => {
        const from = base();
        const to = applyOp(from, {op: 'setNote', id: 'root.2', note: 'x'});
        expect(diffTrees(from, to)).toEqual([{op: 'setNote', id: 'root.2', note: 'x'}]);
        expect(diffTrees(to, from)).toEqual([{op: 'setNote', id: 'root.2', note: ''}]);
    });

    it('gives exactly one move when a topic leaves the middle of its siblings', () => {
        const from = base();
        const to = T.moveNode(from, 'root.0.0', 'root.2');
        expect(diffTrees(from, to)).toEqual([{op: 'move', id: 'root.0.0', parentId: 'root.2', index: 1}]);
        const out = T.moveNode(from, 'root.0', 'root.2', 0);
        expect(diffTrees(from, out)).toEqual([{op: 'move', id: 'root.0', parentId: 'root.2', index: 0}]);
    });

    it('round-trips random edit sequences', () => {
        const r = rng(42);
        for (let run = 0; run < 300; run++) {
            const from = base();
            let to = from;
            const steps = 1 + Math.floor(r() * 8);
            for (let i = 0; i < steps; i++) to = randomEdit(to, r);
            const ops = diffTrees(from, to);
            const result = applyOps(from, ops);
            expect(shape(result.tree)).toEqual(shape(to));
            expect(result.applied.length).toBe(ops.length);
            consistent(result.tree);
        }
    });
});
