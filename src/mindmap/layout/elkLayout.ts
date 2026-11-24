import ELK from 'elkjs/lib/elk.bundled.js';
import type {ElkNode} from 'elkjs/lib/elk.bundled.js';
import {getNode, sideOf, splitBalanced, visibleIds} from '../model/tree';
import type {LayoutKind, MindMapTree, NodeId, Side} from '../model/types';
import {measureTopic, type Size, type TextWidthFn, canvasTextWidth} from './measure';

export interface PlacedNode {
    id: NodeId;
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    /** Direction the node sits relative to its parent (root: `null`). */
    side: Side | null;
}

export interface LayoutResult {
    nodes: Record<NodeId, PlacedNode>;
    /** Visible parent → child pairs. */
    edges: {source: NodeId; target: NodeId; side: Side}[];
}

const elk = new ELK();

type ElkDirection = 'RIGHT' | 'LEFT' | 'DOWN';
const DIRECTION: Record<Side, ElkDirection> = {right: 'RIGHT', left: 'LEFT', down: 'DOWN'};

function layoutOptions(side: Side): Record<string, string> {
    const horizontal = side !== 'down';
    return {
        'elk.algorithm': 'layered',
        'elk.direction': DIRECTION[side],
        // Keep sibling order exactly as in the model.
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
        'elk.layered.spacing.nodeNodeBetweenLayers': horizontal ? '56' : '48',
        'elk.spacing.nodeNode': horizontal ? '14' : '24',
        'elk.layered.spacing.edgeNodeBetweenLayers': '0',
        'elk.spacing.edgeNode': '0',
        'elk.spacing.edgeEdge': '0',
        'elk.layered.mergeEdges': 'true',
    };
}

interface Part {
    root: NodeId;
    roots: NodeId[]; // children of the root included in this part
    side: Side;
}

async function layoutPart(
    tree: MindMapTree,
    part: Part,
    sizes: Map<NodeId, Size>,
): Promise<Map<NodeId, {x: number; y: number}>> {
    const children: ElkNode[] = [];
    const edges: {id: string; sources: string[]; targets: string[]}[] = [];
    const visit = (id: NodeId, kids: NodeId[]) => {
        const size = sizes.get(id)!;
        children.push({id, width: size.width, height: size.height});
        for (const c of kids) {
            edges.push({id: `${id}->${c}`, sources: [id], targets: [c]});
            const cn = getNode(tree, c);
            visit(c, cn.collapsed ? [] : cn.children);
        }
    };
    visit(part.root, part.roots);

    const graph = await elk.layout({id: 'g', layoutOptions: layoutOptions(part.side), children, edges});
    // ELK centres nodes inside their layer. Mind maps read better when every depth
    // column is aligned to the edge facing the parent, so snap the main axis.
    const depth = new Map<NodeId, number>([[part.root, 0]]);
    for (const e of edges) depth.set(e.targets[0], depth.get(e.sources[0])! + 1);
    const anchor = new Map<number, number>();
    for (const n of graph.children ?? []) {
        const d = depth.get(n.id)!;
        const edge = part.side === 'right' ? n.x! : part.side === 'left' ? n.x! + n.width! : n.y!;
        const prev = anchor.get(d);
        anchor.set(d, prev === undefined ? edge : part.side === 'left' ? Math.max(prev, edge) : Math.min(prev, edge));
    }

    const out = new Map<NodeId, {x: number; y: number}>();
    for (const n of graph.children ?? []) {
        const a = anchor.get(depth.get(n.id)!)!;
        if (part.side === 'right') out.set(n.id, {x: a, y: n.y!});
        else if (part.side === 'left') out.set(n.id, {x: a - n.width!, y: n.y!});
        else out.set(n.id, {x: n.x!, y: a});
    }
    return out;
}

/**
 * Computes positions for all visible topics with ELK's layered algorithm.
 * The balanced mind map is laid out as two halves (RIGHT and LEFT) glued at the root.
 * Coordinates are normalised so that the root's top-left corner is at (0, 0).
 */
export async function computeLayout(
    tree: MindMapTree,
    kind: LayoutKind,
    measure: TextWidthFn = canvasTextWidth,
): Promise<LayoutResult> {
    const root = getNode(tree, tree.rootId);
    const rootKids = root.collapsed ? [] : root.children;

    const parts: Part[] =
        kind === 'mindmap'
            ? (() => {
                  const {right, left} = splitBalanced(rootKids);
                  const ps: Part[] = [{root: root.id, roots: right, side: 'right'}];
                  if (left.length) ps.push({root: root.id, roots: left, side: 'left'});
                  return ps;
              })()
            : [{root: root.id, roots: rootKids, side: kind === 'org' ? 'down' : 'right'}];

    // Measure every visible node once.
    const sizes = new Map<NodeId, Size>();
    const sideOfNode = new Map<NodeId, Side>();
    const depths = new Map<NodeId, number>();
    const measureSubtree = (id: NodeId, depth: number, side: Side | null) => {
        const n = getNode(tree, id);
        sizes.set(id, measureTopic(n.text, depth, measure));
        depths.set(id, depth);
        if (side) sideOfNode.set(id, side);
        if (!n.collapsed) n.children.forEach((c) => measureSubtree(c, depth + 1, side));
    };
    measureSubtree(root.id, 0, null);
    for (const p of parts) for (const r of p.roots) measureSubtree(r, 1, p.side);

    const placed: Record<NodeId, PlacedNode> = {};
    const results = await Promise.all(parts.map((p) => layoutPart(tree, p, sizes)));
    results.forEach((positions) => {
        const r = positions.get(root.id)!;
        for (const [id, pos] of positions) {
            const size = sizes.get(id)!;
            placed[id] = {
                id,
                x: pos.x - r.x,
                y: pos.y - r.y,
                width: size.width,
                height: size.height,
                depth: depths.get(id)!,
                side: id === root.id ? null : sideOfNode.get(id)!,
            };
        }
    });

    const edges: LayoutResult['edges'] = [];
    for (const id of Object.keys(placed)) {
        const n = getNode(tree, id);
        if (n.parentId !== null) edges.push({source: n.parentId, target: id, side: placed[id].side!});
    }
    return {nodes: placed, edges};
}

/**
 * ELK runs asynchronously. Topics created after the last layout are placed next to
 * their parent right away so they (and their editor) render without waiting;
 * the next layout pass moves them to their final place.
 */
export function withProvisionalNodes(
    result: LayoutResult,
    tree: MindMapTree,
    kind: LayoutKind,
    measure: TextWidthFn = canvasTextWidth,
): LayoutResult {
    const nodes: Record<NodeId, PlacedNode> = {};
    const edges: LayoutResult['edges'] = [];
    let added = false;
    for (const id of visibleIds(tree)) {
        const n = getNode(tree, id);
        const known = result.nodes[id];
        if (known) {
            nodes[id] = known;
        } else if (n.parentId !== null && nodes[n.parentId]) {
            const parent = nodes[n.parentId];
            const side = sideOf(tree, id, kind);
            const depth = parent.depth + 1;
            const size = measureTopic(n.text, depth, measure);
            const siblings = getNode(tree, n.parentId)
                .children.map((c) => nodes[c])
                .filter(Boolean);
            let x: number;
            let y: number;
            if (side === 'down') {
                y = parent.y + parent.height + 48;
                x = siblings.length ? Math.max(...siblings.map((b) => b.x + b.width)) + 24 : parent.x;
            } else {
                x = side === 'right' ? parent.x + parent.width + 56 : parent.x - 56 - size.width;
                y = siblings.length
                    ? Math.max(...siblings.map((b) => b.y + b.height)) + 14
                    : parent.y + (parent.height - size.height) / 2;
            }
            nodes[id] = {id, x, y, ...size, depth, side};
            added = true;
        } else {
            continue;
        }
        if (n.parentId !== null && nodes[n.parentId])
            edges.push({source: n.parentId, target: id, side: nodes[id].side!});
    }
    return added || Object.keys(nodes).length !== Object.keys(result.nodes).length ? {nodes, edges} : result;
}
