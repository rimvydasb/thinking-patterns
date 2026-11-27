export type NodeId = string;

export interface MindNode {
    id: NodeId;
    text: string;
    parentId: NodeId | null;
    children: NodeId[];
    collapsed?: boolean;
    /** Free Markdown text about the topic (the `# Notes` section of the map file). Absent when empty. */
    note?: string;
    /** Icon shortcodes shown in front of the text (see `icons.ts`), at most one per group. Absent when none. */
    icons?: string[];
}

/** Normalized, immutable mind map. Every operation returns a new tree. */
export interface MindMapTree {
    rootId: NodeId;
    nodes: Record<NodeId, MindNode>;
    /** Layout of the map (`mindmap-layout` in the map file frontmatter). Absent: `mindmap`. */
    layout?: LayoutKind;
}

/** Nested, human-friendly description of a map (maps 1:1 to a Markdown list later). */
export interface Outline {
    text: string;
    collapsed?: boolean;
    note?: string;
    icons?: string[];
    children?: Outline[];
}

/**
 * - `mindmap`: balanced, branches on both sides of the central topic
 * - `logic`: all branches to the right (XMind "Logic Chart")
 * - `org`: top-down (XMind "Org Chart")
 */
export type LayoutKind = 'mindmap' | 'logic' | 'org';

export const LAYOUT_KINDS: readonly LayoutKind[] = ['mindmap', 'logic', 'org'];

export const isLayoutKind = (value: unknown): value is LayoutKind => LAYOUT_KINDS.includes(value as LayoutKind);

/** The layout a map is shown with. */
export const layoutOf = (tree: MindMapTree): LayoutKind => tree.layout ?? 'mindmap';

/** Direction in which a node's children grow. */
export type Side = 'right' | 'left' | 'down';
