import {normalize} from '../topicPath';
import {newId} from '../tree';
import type {MindMapTree, MindNode, NodeId} from '../types';

/**
 * Returns `parsed` with the ids of `previous` where topics match, so a file change keeps the selection, the undo
 * history and pending GUI edits of unchanged, renamed and moved topics. Text and notes always come from `parsed`;
 * `collapsed` comes from `previous` for matched topics. Only the ids depend on the match, never the content.
 *
 * Steps (docs/map-file-lifecycle-story.md, "Id reconciliation"):
 * 1. Root to root.
 * 2. Children of matched parents: equal normalized text, in order (longest common subsequence).
 * 3. Remaining children of matched parents, if the remaining counts are equal: by position (rename in place).
 * 4. Remaining topics anywhere: equal normalized text, if that text is unique among the remaining topics (move).
 * 5. Remaining new topics get new ids; remaining old topics are removed.
 * Steps 2 and 3 run top-down. Step 4 runs when no matched parent is left to process, and its matches are processed
 * top-down again; the loop ends when step 4 finds nothing.
 */
export function reconcileTrees(previous: MindMapTree, parsed: MindMapTree): MindMapTree {
    const toOld = new Map<NodeId, NodeId>(); // parsed id -> previous id
    const usedOld = new Set<NodeId>();
    const queue: NodeId[] = []; // matched parsed ids whose children are not processed yet
    const processed = new Set<NodeId>();

    const match = (parsedId: NodeId, oldId: NodeId) => {
        toOld.set(parsedId, oldId);
        usedOld.add(oldId);
        queue.push(parsedId);
    };
    const text = (t: MindMapTree, id: NodeId) => normalize(t.nodes[id].text);

    match(parsed.rootId, previous.rootId);

    const processChildren = (newParent: NodeId) => {
        const oldParent = toOld.get(newParent)!;
        const fresh = parsed.nodes[newParent].children.filter((c) => !toOld.has(c));
        const old = previous.nodes[oldParent].children.filter((c) => !usedOld.has(c));
        const pairs = lcs(
            fresh.map((c) => text(parsed, c)),
            old.map((c) => text(previous, c)),
        );
        for (const [i, j] of pairs) match(fresh[i], old[j]);
        const restNew = fresh.filter((c) => !toOld.has(c));
        const restOld = old.filter((c) => !usedOld.has(c));
        if (restNew.length === restOld.length) restNew.forEach((c, i) => match(c, restOld[i]));
    };

    for (;;) {
        while (queue.length) {
            const id = queue.shift()!;
            if (processed.has(id)) continue;
            processed.add(id);
            processChildren(id);
        }
        const moved = matchUniqueTexts(parsed, previous, toOld, usedOld, text);
        if (!moved.length) break;
        for (const [n, o] of moved) match(n, o);
    }

    const idOf = new Map<NodeId, NodeId>();
    for (const id of Object.keys(parsed.nodes)) idOf.set(id, toOld.get(id) ?? newId());
    const nodes: Record<NodeId, MindNode> = {};
    for (const n of Object.values(parsed.nodes)) {
        const id = idOf.get(n.id)!;
        const old = toOld.has(n.id) ? previous.nodes[toOld.get(n.id)!] : undefined;
        const node: MindNode = {
            id,
            text: n.text,
            parentId: n.parentId === null ? null : idOf.get(n.parentId)!,
            children: n.children.map((c) => idOf.get(c)!),
        };
        if (old?.collapsed && n.children.length) node.collapsed = true;
        if (n.note) node.note = n.note;
        nodes[id] = node;
    }
    return {rootId: idOf.get(parsed.rootId)!, nodes};
}

/** Step 4: pairs of remaining topics whose text is unique among the remaining topics on both sides. */
function matchUniqueTexts(
    parsed: MindMapTree,
    previous: MindMapTree,
    toOld: Map<NodeId, NodeId>,
    usedOld: Set<NodeId>,
    text: (t: MindMapTree, id: NodeId) => string,
): [NodeId, NodeId][] {
    const group = (t: MindMapTree, ids: NodeId[]) => {
        const by = new Map<string, NodeId[]>();
        for (const id of ids) by.set(text(t, id), [...(by.get(text(t, id)) ?? []), id]);
        return by;
    };
    const newBy = group(
        parsed,
        Object.keys(parsed.nodes).filter((id) => !toOld.has(id)),
    );
    const oldBy = group(
        previous,
        Object.keys(previous.nodes).filter((id) => !usedOld.has(id)),
    );
    const pairs: [NodeId, NodeId][] = [];
    for (const [t, ids] of newBy) {
        const olds = oldBy.get(t);
        if (ids.length === 1 && olds?.length === 1) pairs.push([ids[0], olds[0]]);
    }
    return pairs;
}

/** Index pairs of a longest common subsequence of `a` and `b`, in order. */
function lcs(a: string[], b: string[]): [number, number][] {
    const n = a.length;
    const m = b.length;
    const len: number[][] = Array.from({length: n + 1}, () => Array.from({length: m + 1}, () => 0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
        }
    }
    const pairs: [number, number][] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            pairs.push([i, j]);
            i++;
            j++;
        } else if (len[i + 1][j] >= len[i][j + 1]) i++;
        else j++;
    }
    return pairs;
}
