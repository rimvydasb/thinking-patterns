import type { LayoutKind, MindMapTree, MindNode, NodeId, Outline, Side } from './types';

let idCounter = 0;
/** Unique-enough ids for an in-memory MVP. */
export function newId(): NodeId {
  idCounter += 1;
  return `n${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Construction / conversion
// ---------------------------------------------------------------------------

export function createTree(rootText = 'Central Topic', rootId: NodeId = 'root'): MindMapTree {
  return { rootId, nodes: { [rootId]: { id: rootId, text: rootText, parentId: null, children: [] } } };
}

/** Builds a tree from a nested outline. Ids are deterministic (`root`, `root.0`, `root.0.1`, ...). */
export function fromOutline(outline: Outline): MindMapTree {
  const nodes: Record<NodeId, MindNode> = {};
  const visit = (o: Outline, id: NodeId, parentId: NodeId | null) => {
    const children = (o.children ?? []).map((_, i) => `${id}.${i}`);
    nodes[id] = { id, text: o.text, parentId, children, ...(o.collapsed ? { collapsed: true } : {}) };
    (o.children ?? []).forEach((c, i) => visit(c, children[i], id));
  };
  visit(outline, 'root', null);
  return { rootId: 'root', nodes };
}

export function toOutline(tree: MindMapTree, id: NodeId = tree.rootId): Outline {
  const n = tree.nodes[id];
  const out: Outline = { text: n.text };
  if (n.collapsed) out.collapsed = true;
  if (n.children.length) out.children = n.children.map((c) => toOutline(tree, c));
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getNode(tree: MindMapTree, id: NodeId): MindNode {
  const n = tree.nodes[id];
  if (!n) throw new Error(`Unknown node: ${id}`);
  return n;
}

export function depthOf(tree: MindMapTree, id: NodeId): number {
  let d = 0;
  let cur = getNode(tree, id);
  while (cur.parentId !== null) {
    d += 1;
    cur = getNode(tree, cur.parentId);
  }
  return d;
}

/** Path from root to the node (inclusive). */
export function pathTo(tree: MindMapTree, id: NodeId): NodeId[] {
  const path: NodeId[] = [];
  let cur: MindNode | undefined = getNode(tree, id);
  while (cur) {
    path.unshift(cur.id);
    cur = cur.parentId === null ? undefined : tree.nodes[cur.parentId];
  }
  return path;
}

/** Index of the main (depth 1) branch the node belongs to, or -1 for the root. */
export function branchIndex(tree: MindMapTree, id: NodeId): number {
  const path = pathTo(tree, id);
  if (path.length < 2) return -1;
  return getNode(tree, tree.rootId).children.indexOf(path[1]);
}

export function isDescendant(tree: MindMapTree, ancestor: NodeId, id: NodeId): boolean {
  return pathTo(tree, id).slice(0, -1).includes(ancestor);
}

export function subtreeIds(tree: MindMapTree, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    stack.push(...getNode(tree, cur).children);
  }
  return out;
}

/** Node ids that are rendered (descendants of collapsed nodes are hidden). Pre-order. */
export function visibleIds(tree: MindMapTree): NodeId[] {
  const out: NodeId[] = [];
  const visit = (id: NodeId) => {
    out.push(id);
    const n = getNode(tree, id);
    if (!n.collapsed) n.children.forEach(visit);
  };
  visit(tree.rootId);
  return out;
}

export function hiddenDescendantCount(tree: MindMapTree, id: NodeId): number {
  const n = getNode(tree, id);
  return n.collapsed ? subtreeIds(tree, id).length - 1 : 0;
}

/**
 * Splits the root's children for the balanced mind map layout:
 * the first half grows to the right, the rest to the left.
 */
export function splitBalanced<T>(children: readonly T[]): { right: T[]; left: T[] } {
  const cut = Math.ceil(children.length / 2);
  return { right: children.slice(0, cut), left: children.slice(cut) };
}

/** Direction in which the children of `id` grow for the given layout. */
export function sideOf(tree: MindMapTree, id: NodeId, layout: LayoutKind): Side {
  if (layout === 'org') return 'down';
  if (layout === 'logic') return 'right';
  const path = pathTo(tree, id);
  if (path.length < 2) return 'right'; // root: has both sides, "right" is the default
  const { left } = splitBalanced(getNode(tree, tree.rootId).children);
  return left.includes(path[1]) ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// Mutations (pure)
// ---------------------------------------------------------------------------

function withNodes(tree: MindMapTree, patch: Record<NodeId, MindNode>): MindMapTree {
  return { ...tree, nodes: { ...tree.nodes, ...patch } };
}

export function defaultTextFor(depth: number): string {
  if (depth <= 0) return 'Central Topic';
  return depth === 1 ? 'Main Topic' : 'Subtopic';
}

export interface InsertResult {
  tree: MindMapTree;
  id: NodeId;
}

/** Inserts a new child of `parentId` at `index` (default: last). Expands the parent. */
export function addChild(
  tree: MindMapTree,
  parentId: NodeId,
  opts: { text?: string; index?: number; id?: NodeId } = {},
): InsertResult {
  const parent = getNode(tree, parentId);
  const id = opts.id ?? newId();
  const text = opts.text ?? defaultTextFor(depthOf(tree, parentId) + 1);
  const children = [...parent.children];
  const index = opts.index === undefined ? children.length : Math.max(0, Math.min(opts.index, children.length));
  children.splice(index, 0, id);
  return {
    id,
    tree: withNodes(tree, {
      [parentId]: { ...parent, children, collapsed: false },
      [id]: { id, text, parentId, children: [] },
    }),
  };
}

/** Inserts a sibling next to `id`. For the root (no siblings) a child is added instead. */
export function addSibling(
  tree: MindMapTree,
  id: NodeId,
  position: 'before' | 'after' = 'after',
  opts: { text?: string; id?: NodeId } = {},
): InsertResult {
  const node = getNode(tree, id);
  if (node.parentId === null) return addChild(tree, id, opts);
  const idx = getNode(tree, node.parentId).children.indexOf(id);
  return addChild(tree, node.parentId, { ...opts, index: position === 'after' ? idx + 1 : idx });
}

/** Inserts a new node between `id` and its parent (XMind "Insert Parent Topic"). */
export function addParent(tree: MindMapTree, id: NodeId, opts: { text?: string; id?: NodeId } = {}): InsertResult {
  const node = getNode(tree, id);
  if (node.parentId === null) return { tree, id };
  const parent = getNode(tree, node.parentId);
  const newNodeId = opts.id ?? newId();
  const text = opts.text ?? defaultTextFor(depthOf(tree, id));
  return {
    id: newNodeId,
    tree: withNodes(tree, {
      [parent.id]: { ...parent, children: parent.children.map((c) => (c === id ? newNodeId : c)) },
      [newNodeId]: { id: newNodeId, text, parentId: parent.id, children: [id] },
      [id]: { ...node, parentId: newNodeId },
    }),
  };
}

export interface RemoveResult {
  tree: MindMapTree;
  /** Suggested node to select after removal. */
  nextSelection: NodeId;
}

/** Removes a node and its subtree. The root cannot be removed. */
export function removeNode(tree: MindMapTree, id: NodeId): RemoveResult {
  const node = getNode(tree, id);
  if (node.parentId === null) return { tree, nextSelection: id };
  const parent = getNode(tree, node.parentId);
  const idx = parent.children.indexOf(id);
  const children = parent.children.filter((c) => c !== id);
  const nodes = { ...tree.nodes, [parent.id]: { ...parent, children } };
  for (const sid of subtreeIds(tree, id)) delete nodes[sid];
  const nextSelection = children[idx] ?? children[idx - 1] ?? parent.id;
  return { tree: { ...tree, nodes }, nextSelection };
}

export function updateText(tree: MindMapTree, id: NodeId, text: string): MindMapTree {
  const node = getNode(tree, id);
  if (node.text === text) return tree;
  return withNodes(tree, { [id]: { ...node, text } });
}

export function setCollapsed(tree: MindMapTree, id: NodeId, collapsed: boolean): MindMapTree {
  const node = getNode(tree, id);
  if (!node.children.length || !!node.collapsed === collapsed) return tree;
  return withNodes(tree, { [id]: { ...node, collapsed } });
}

export function toggleCollapsed(tree: MindMapTree, id: NodeId): MindMapTree {
  return setCollapsed(tree, id, !getNode(tree, id).collapsed);
}

/** Moves a node among its siblings by `delta` positions (clamped). */
export function moveAmongSiblings(tree: MindMapTree, id: NodeId, delta: number): MindMapTree {
  const node = getNode(tree, id);
  if (node.parentId === null) return tree;
  const parent = getNode(tree, node.parentId);
  const from = parent.children.indexOf(id);
  const to = Math.max(0, Math.min(parent.children.length - 1, from + delta));
  if (from === to) return tree;
  const children = [...parent.children];
  children.splice(from, 1);
  children.splice(to, 0, id);
  return withNodes(tree, { [parent.id]: { ...parent, children } });
}

/** Re-parents `id` under `newParentId` (at `index`, default last). Refuses cycles. */
export function moveNode(tree: MindMapTree, id: NodeId, newParentId: NodeId, index?: number): MindMapTree {
  const node = getNode(tree, id);
  if (node.parentId === null || id === newParentId || isDescendant(tree, id, newParentId)) return tree;
  const oldParent = getNode(tree, node.parentId);
  let next = withNodes(tree, {
    [oldParent.id]: { ...oldParent, children: oldParent.children.filter((c) => c !== id) },
  });
  const newParent = getNode(next, newParentId);
  const children = [...newParent.children];
  children.splice(index ?? children.length, 0, id);
  next = withNodes(next, {
    [newParentId]: { ...newParent, children, collapsed: false },
    [id]: { ...node, parentId: newParentId },
  });
  return next;
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const TOWARD: Record<Side, ArrowKey> = { right: 'ArrowRight', left: 'ArrowLeft', down: 'ArrowDown' };
const AWAY: Record<Side, ArrowKey> = { right: 'ArrowLeft', left: 'ArrowRight', down: 'ArrowUp' };

function firstVisibleChild(ids: NodeId[], parent: MindNode): NodeId | null {
  if (parent.collapsed || !ids.length) return null;
  return ids[0];
}

/**
 * Returns the node to select when an arrow key is pressed, following the
 * visual direction of the layout. Returns the same id if there is nowhere to go.
 */
export function navigate(tree: MindMapTree, id: NodeId, key: ArrowKey, layout: LayoutKind): NodeId {
  const node = getNode(tree, id);

  if (node.parentId === null) {
    if (layout === 'mindmap') {
      const { right, left } = splitBalanced(node.children);
      if (key === 'ArrowRight') return firstVisibleChild(right, node) ?? id;
      if (key === 'ArrowLeft') return firstVisibleChild(left, node) ?? id;
      return id;
    }
    const side = sideOf(tree, id, layout);
    return key === TOWARD[side] ? (firstVisibleChild(node.children, node) ?? id) : id;
  }

  const side = sideOf(tree, id, layout);
  if (key === TOWARD[side]) return firstVisibleChild(node.children, node) ?? id;
  if (key === AWAY[side]) return node.parentId;

  // Perpendicular keys move between siblings (only those on the same side of the root).
  let siblings = getNode(tree, node.parentId).children;
  if (layout === 'mindmap' && node.parentId === tree.rootId) {
    const { right, left } = splitBalanced(siblings);
    siblings = right.includes(id) ? right : left;
  }
  const idx = siblings.indexOf(id);
  const prev = side === 'down' ? key === 'ArrowLeft' : key === 'ArrowUp';
  const target = siblings[idx + (prev ? -1 : 1)];
  return target ?? id;
}
