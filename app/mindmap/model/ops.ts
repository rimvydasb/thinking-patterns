import {normalizeIcons, sameIcons} from './icons';
import type {LayoutKind, MindMapTree, MindNode, NodeId, Outline} from './types';

/**
 * A change to a mind map. Ops are the unit of synchronisation between the app, the server and agents (MCP).
 *
 * Ops carry explicit ids and are applied leniently: an op that no longer fits the tree (its node was removed by
 * someone else, a move would create a cycle, an id already exists) is skipped instead of failing. This lets a
 * client re-apply its unconfirmed ops on top of the newest server state (rebase) without conflicts.
 */
export type MapOp =
    /** Inserts a new leaf topic. `index` is clamped to the parent's child count. */
    | {op: 'add'; id: NodeId; parentId: NodeId; index: number; text: string}
    /** Removes a topic and its whole subtree. The root is never removed. */
    | {op: 'remove'; id: NodeId}
    /** Re-parents a topic. `index` is the topic's position among the new siblings after the move. */
    | {op: 'move'; id: NodeId; parentId: NodeId; index: number}
    | {op: 'setText'; id: NodeId; text: string}
    | {op: 'setCollapsed'; id: NodeId; collapsed: boolean}
    /** Sets the note of a topic. An empty string removes the note. */
    | {op: 'setNote'; id: NodeId; note: string}
    /** Sets the icon shortcodes of a topic (see `icons.ts`). An empty list removes the icons. */
    | {op: 'setIcons'; id: NodeId; icons: string[]}
    /** Sets the layout of the whole map. `null` removes it (the default `mindmap` layout applies). */
    | {op: 'setLayout'; layout: LayoutKind | null};

export type MapOpKind = MapOp['op'];

function clamp(i: number, max: number): number {
    return Math.max(0, Math.min(Number.isFinite(i) ? Math.trunc(i) : max, max));
}

function isInSubtree(tree: MindMapTree, ancestor: NodeId, id: NodeId): boolean {
    let cur: MindNode | undefined = tree.nodes[id];
    while (cur) {
        if (cur.id === ancestor) return true;
        cur = cur.parentId === null ? undefined : tree.nodes[cur.parentId];
    }
    return false;
}

/** Applies one op. Returns the same tree object when the op does not apply. */
export function applyOp(tree: MindMapTree, op: MapOp): MindMapTree {
    const nodes = tree.nodes;
    switch (op.op) {
        case 'add': {
            const parent = nodes[op.parentId];
            if (!parent || nodes[op.id]) return tree;
            const children = [...parent.children];
            children.splice(clamp(op.index, children.length), 0, op.id);
            return {
                ...tree,
                nodes: {
                    ...nodes,
                    [parent.id]: {...parent, children},
                    [op.id]: {id: op.id, text: op.text, parentId: parent.id, children: []},
                },
            };
        }
        case 'remove': {
            const node = nodes[op.id];
            if (!node || node.parentId === null) return tree;
            const parent = nodes[node.parentId];
            const next = {...nodes, [parent.id]: {...parent, children: parent.children.filter((c) => c !== op.id)}};
            const stack = [op.id];
            while (stack.length) {
                const id = stack.pop()!;
                stack.push(...nodes[id].children);
                delete next[id];
            }
            return {...tree, nodes: next};
        }
        case 'move': {
            const node = nodes[op.id];
            const target = nodes[op.parentId];
            if (!node || !target || node.parentId === null || isInSubtree(tree, op.id, op.parentId)) return tree;
            const oldParent = nodes[node.parentId];
            const without = oldParent.children.filter((c) => c !== op.id);
            const base = oldParent.id === target.id ? without : target.children;
            const children = [...base];
            const index = clamp(op.index, children.length);
            if (oldParent.id === target.id && oldParent.children[index] === op.id) return tree;
            children.splice(index, 0, op.id);
            return {
                ...tree,
                nodes: {
                    ...nodes,
                    [oldParent.id]: {...oldParent, children: without},
                    [target.id]: {...(oldParent.id === target.id ? oldParent : target), children},
                    [op.id]: {...node, parentId: target.id},
                },
            };
        }
        case 'setText': {
            const node = nodes[op.id];
            if (!node || node.text === op.text) return tree;
            return {...tree, nodes: {...nodes, [op.id]: {...node, text: op.text}}};
        }
        case 'setCollapsed': {
            const node = nodes[op.id];
            if (!node || !!node.collapsed === op.collapsed) return tree;
            const {collapsed: _drop, ...rest} = node;
            return {...tree, nodes: {...nodes, [op.id]: op.collapsed ? {...rest, collapsed: true} : rest}};
        }
        case 'setNote': {
            const node = nodes[op.id];
            if (!node || (node.note ?? '') === op.note) return tree;
            const {note: _drop, ...rest} = node;
            return {...tree, nodes: {...nodes, [op.id]: op.note ? {...rest, note: op.note} : rest}};
        }
        case 'setIcons': {
            const node = nodes[op.id];
            if (!node || sameIcons(node.icons, op.icons)) return tree;
            const {icons: _drop, ...rest} = node;
            return {...tree, nodes: {...nodes, [op.id]: op.icons.length ? {...rest, icons: [...op.icons]} : rest}};
        }
        case 'setLayout': {
            if ((tree.layout ?? null) === op.layout) return tree;
            const {layout: _drop, ...rest} = tree;
            return op.layout ? {...rest, layout: op.layout} : rest;
        }
    }
}

export interface ApplyResult {
    tree: MindMapTree;
    /** The ops that changed the tree, in order. Skipped ops are left out. */
    applied: MapOp[];
}

/** Applies ops in order and reports which ones took effect. */
export function applyOps(tree: MindMapTree, ops: readonly MapOp[]): ApplyResult {
    let cur = tree;
    const applied: MapOp[] = [];
    for (const op of ops) {
        const next = applyOp(cur, op);
        if (next !== cur) applied.push(op);
        cur = next;
    }
    return {tree: cur, applied};
}

/**
 * Computes ops that turn `from` into `to`: `applyOps(from, diffTrees(from, to)).tree` equals `to`.
 * Both trees MUST share the root id.
 *
 * Order: adds and moves in pre-order of `to` (so a parent is in its final place before its children arrive and a
 * move can never create a cycle), then text, collapse, note and icon changes, then removals of what is left over,
 * then the layout.
 * A child is moved only when its order relative to the siblings that stay under the same parent changes, so a topic
 * that leaves a parent causes exactly one `move` and no reordering of the siblings it leaves behind.
 */
export function diffTrees(from: MindMapTree, to: MindMapTree): MapOp[] {
    if (from === to) return [];
    if (from.rootId !== to.rootId) throw new Error('diffTrees: trees have different roots');
    const ops: MapOp[] = [];
    let work = from;
    const push = (op: MapOp) => {
        ops.push(op);
        work = applyOp(work, op);
    };

    const visit = (id: NodeId) => {
        const wanted = to.nodes[id].children;
        const stays = new Set(wanted);
        wanted.forEach((childId, index) => {
            const current = work.nodes[id].children;
            const prev = index === 0 ? null : wanted[index - 1];
            const existing = work.nodes[childId];
            if (!existing || existing.parentId !== id) {
                const at = prev === null ? 0 : current.indexOf(prev) + 1;
                if (!existing) push({op: 'add', id: childId, parentId: id, index: at, text: to.nodes[childId].text});
                else push({op: 'move', id: childId, parentId: id, index: at});
                return;
            }
            if (current.filter((c) => stays.has(c))[index] === childId) return;
            const without = current.filter((c) => c !== childId);
            push({op: 'move', id: childId, parentId: id, index: prev === null ? 0 : without.indexOf(prev) + 1});
        });
        wanted.forEach(visit);
    };
    visit(to.rootId);

    for (const id of Object.keys(to.nodes)) {
        const a = work.nodes[id];
        const b = to.nodes[id];
        if (a.text !== b.text) push({op: 'setText', id, text: b.text});
        if (!!a.collapsed !== !!b.collapsed) push({op: 'setCollapsed', id, collapsed: !!b.collapsed});
        if ((a.note ?? '') !== (b.note ?? '')) push({op: 'setNote', id, note: b.note ?? ''});
        if (!sameIcons(a.icons, b.icons)) push({op: 'setIcons', id, icons: [...(b.icons ?? [])]});
    }

    for (const id of Object.keys(from.nodes)) {
        if (!to.nodes[id] && work.nodes[id]) push({op: 'remove', id});
    }
    if ((from.layout ?? null) !== (to.layout ?? null)) push({op: 'setLayout', layout: to.layout ?? null});
    return ops;
}

/** Ops that insert `outlines` under `parentId`, starting at `index`. New ids come from `makeId`. */
export function outlineToOps(
    outlines: readonly Outline[],
    parentId: NodeId,
    index: number,
    makeId: () => NodeId,
): {ops: MapOp[]; ids: NodeId[]} {
    const ops: MapOp[] = [];
    const ids: NodeId[] = [];
    const visit = (o: Outline, parent: NodeId, at: number, top: boolean) => {
        const id = makeId();
        if (top) ids.push(id);
        ops.push({op: 'add', id, parentId: parent, index: at, text: o.text});
        if (o.note) ops.push({op: 'setNote', id, note: o.note});
        const icons = normalizeIcons(o.icons ?? []);
        if (icons.length) ops.push({op: 'setIcons', id, icons});
        (o.children ?? []).forEach((c, i) => visit(c, id, i, false));
        if (o.collapsed && o.children?.length) ops.push({op: 'setCollapsed', id, collapsed: true});
    };
    outlines.forEach((o, i) => visit(o, parentId, index + i, true));
    return {ops, ids};
}
