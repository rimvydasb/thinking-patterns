import type {MindMapTree, MindNode, NodeId, Outline} from './types';

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
    | {op: 'setCollapsed'; id: NodeId; collapsed: boolean};

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
 * move can never create a cycle), then text and collapse changes, then removals of what is left over.
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
        const target = to.nodes[id];
        target.children.forEach((childId, index) => {
            const existing = work.nodes[childId];
            if (!existing) {
                push({op: 'add', id: childId, parentId: id, index, text: to.nodes[childId].text});
            } else if (existing.parentId !== id || work.nodes[id].children[index] !== childId) {
                push({op: 'move', id: childId, parentId: id, index});
            }
        });
        target.children.forEach(visit);
    };
    visit(to.rootId);

    for (const id of Object.keys(to.nodes)) {
        const a = work.nodes[id];
        const b = to.nodes[id];
        if (a.text !== b.text) push({op: 'setText', id, text: b.text});
        if (!!a.collapsed !== !!b.collapsed) push({op: 'setCollapsed', id, collapsed: !!b.collapsed});
    }

    for (const id of Object.keys(from.nodes)) {
        if (!to.nodes[id] && work.nodes[id]) push({op: 'remove', id});
    }
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
        (o.children ?? []).forEach((c, i) => visit(c, id, i, false));
        if (o.collapsed && o.children?.length) ops.push({op: 'setCollapsed', id, collapsed: true});
    };
    outlines.forEach((o, i) => visit(o, parentId, index + i, true));
    return {ops, ids};
}
