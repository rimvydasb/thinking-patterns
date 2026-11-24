import {applyOps, diffTrees, type MapOp} from '../ops';
import * as T from '../tree';
import type {MindMapTree, MindNode, NodeId, Outline} from '../types';
import {reconcileTrees} from './reconcile';

const previous = () =>
    T.fromOutline({
        text: 'Plan',
        children: [
            {text: 'Product', collapsed: true, children: [{text: 'Risks'}, {text: 'Goals'}]},
            {text: 'Marketing', children: [{text: 'Risks'}, {text: 'Channels'}]},
            {text: 'Budget'},
        ],
    });

/** A tree as the parser returns it: same content, fresh ids, no folded state. */
function parsedFrom(source: MindMapTree | Outline): MindMapTree {
    const tree = 'rootId' in source ? source : T.fromOutline(source);
    const ids = new Map(Object.keys(tree.nodes).map((id, i) => [id, `p${i}`]));
    const nodes: Record<NodeId, MindNode> = {};
    for (const n of Object.values(tree.nodes)) {
        const {collapsed: _c, ...rest} = n;
        nodes[ids.get(n.id)!] = {
            ...rest,
            id: ids.get(n.id)!,
            parentId: n.parentId === null ? null : ids.get(n.parentId)!,
            children: n.children.map((c) => ids.get(c)!),
        };
    }
    return {rootId: ids.get(tree.rootId)!, nodes};
}

/** Content without ids and folded state. */
const content = (t: MindMapTree, id: NodeId = t.rootId): unknown => {
    const n = t.nodes[id];
    return [n.text, n.note ?? '', n.children.map((c) => content(t, c))];
};

const opsFor = (prev: MindMapTree, parsed: MindMapTree): MapOp[] => diffTrees(prev, reconcileTrees(prev, parsed));

describe('reconcileTrees', () => {
    it('keeps every id when nothing changed, and gives no ops', () => {
        const prev = previous();
        const next = reconcileTrees(prev, parsedFrom(prev));
        expect(next).toEqual(prev);
        expect(diffTrees(prev, next)).toEqual([]);
    });

    it('gives exactly one setText op for a rename', () => {
        const prev = previous();
        expect(opsFor(prev, parsedFrom(T.updateText(prev, 'root.1.1', 'Social media')))).toEqual([
            {op: 'setText', id: 'root.1.1', text: 'Social media'},
        ]);
    });

    it('gives exactly one setText op for a rename of the central topic', () => {
        const prev = previous();
        expect(opsFor(prev, parsedFrom(T.updateText(prev, 'root', 'Roadmap')))).toEqual([
            {op: 'setText', id: 'root', text: 'Roadmap'},
        ]);
    });

    it('gives exactly one move op for a reorder', () => {
        const prev = previous();
        expect(opsFor(prev, parsedFrom(T.moveAmongSiblings(prev, 'root.2', -2)))).toEqual([
            {op: 'move', id: 'root.2', parentId: 'root', index: 0},
        ]);
    });

    it('gives exactly one move op for a move to another parent', () => {
        const prev = previous();
        expect(opsFor(prev, parsedFrom(T.moveNode(prev, 'root.0.1', 'root.2')))).toEqual([
            {op: 'move', id: 'root.0.1', parentId: 'root.2', index: 0},
        ]);
    });

    it('keeps the ids of a moved subtree', () => {
        const prev = previous();
        const next = reconcileTrees(prev, parsedFrom(T.moveNode(prev, 'root.1', 'root.2')));
        expect(next.nodes['root.1'].parentId).toBe('root.2');
        expect(next.nodes['root.1'].children).toEqual(['root.1.0', 'root.1.1']);
    });

    it('adds new topics with new ids and removes deleted ones', () => {
        const prev = previous();
        const edited = T.addChild(T.removeNode(prev, 'root.1').tree, 'root.2', {text: 'Q3'}).tree;
        const ops = opsFor(prev, parsedFrom(edited));
        expect(ops.map((o) => o.op)).toEqual(['add', 'remove']);
        expect(ops[0]).toMatchObject({op: 'add', parentId: 'root.2', text: 'Q3'});
        expect(ops[1]).toEqual({op: 'remove', id: 'root.1'});
    });

    it('matches equal sibling texts in order and keeps topics with the same text apart', () => {
        const prev = T.fromOutline({text: 'R', children: [{text: 'X'}, {text: 'X'}, {text: 'Y'}]});
        const parsed = parsedFrom({text: 'R', children: [{text: 'X'}, {text: 'Y'}, {text: 'X'}]});
        const next = reconcileTrees(prev, parsed);
        expect(next.nodes.root.children).toEqual(['root.0', 'root.2', 'root.1']);
    });

    it('matches a moved topic by text among the remaining topics only', () => {
        const prev = previous();
        // "Risks" leaves Marketing for Budget. The other "Risks" stays under Product and is matched in step 2,
        // so the moved one is unique among the remaining topics and step 4 matches it.
        const parsed = parsedFrom(T.moveNode(prev, 'root.1.0', 'root.2'));
        const next = reconcileTrees(prev, parsed);
        expect(next.nodes['root.0.0'].parentId).toBe('root.0');
        expect(next.nodes['root.1.0'].parentId).toBe('root.2');
    });

    it('does not guess when a remaining text is not unique', () => {
        const prev = previous();
        // Both "Risks" topics move to Budget: two remaining old and two remaining new topics share the text.
        const moved = T.moveNode(T.moveNode(prev, 'root.0.0', 'root.2'), 'root.1.0', 'root.2');
        const next = reconcileTrees(prev, parsedFrom(moved));
        expect(next.nodes['root.0.0']).toBeUndefined();
        expect(next.nodes['root.1.0']).toBeUndefined();
        expect(content(next)).toEqual(content(moved));
    });

    it('keeps the folded state of matched topics and takes notes from the file', () => {
        const prev = previous();
        const parsed = parsedFrom({
            text: 'Plan',
            children: [
                {text: 'Product', note: 'New note', children: [{text: 'Risks'}, {text: 'Goals'}]},
                {text: 'Marketing', children: [{text: 'Risks'}, {text: 'Channels'}]},
                {text: 'Budget'},
            ],
        });
        const next = reconcileTrees(prev, parsed);
        expect(next.nodes['root.0']).toMatchObject({collapsed: true, note: 'New note'});
        expect(diffTrees(prev, next)).toEqual([{op: 'setNote', id: 'root.0', note: 'New note'}]);
    });

    it('replaces a whole file: only the root keeps its id', () => {
        const prev = previous();
        const parsed = parsedFrom({text: 'Other', children: [{text: 'A', children: [{text: 'B'}]}, {text: 'C'}]});
        const next = reconcileTrees(prev, parsed);
        expect(next.rootId).toBe('root');
        expect(content(applyOps(prev, diffTrees(prev, next)).tree)).toEqual(content(parsed));
    });

    it('keeps the content of the file for random edits', () => {
        let seed = 7;
        const r = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        const edit = (t: MindMapTree): MindMapTree => {
            const ids = Object.keys(t.nodes);
            const pick = () => ids[Math.floor(r() * ids.length)];
            switch (Math.floor(r() * 7)) {
                case 0:
                    return T.addChild(t, pick(), {text: ['Risks', 'New', 'Goals'][Math.floor(r() * 3)]}).tree;
                case 1:
                    return T.removeNode(t, pick()).tree;
                case 2:
                    return T.moveNode(t, pick(), pick(), Math.floor(r() * 3));
                case 3:
                    return T.moveAmongSiblings(t, pick(), r() < 0.5 ? -1 : 1);
                case 4:
                    return T.updateText(t, pick(), `t${Math.floor(r() * 5)}`);
                case 5: {
                    const id = pick();
                    return {...t, nodes: {...t.nodes, [id]: {...t.nodes[id], note: `n${Math.floor(r() * 3)}`}}};
                }
                default:
                    return T.addParent(t, pick(), {text: 'Group'}).tree;
            }
        };
        for (let run = 0; run < 400; run++) {
            let prev = previous();
            for (let i = Math.floor(r() * 4); i > 0; i--) prev = edit(prev);
            let target = prev;
            for (let i = 1 + Math.floor(r() * 6); i > 0; i--) target = edit(target);
            const parsed = parsedFrom(target);
            const result = applyOps(prev, diffTrees(prev, reconcileTrees(prev, parsed)));
            expect(content(result.tree)).toEqual(content(parsed));
        }
    });
});
