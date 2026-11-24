export type NodeId = string;

export interface MindNode {
    id: NodeId;
    text: string;
    parentId: NodeId | null;
    children: NodeId[];
    collapsed?: boolean;
    /** Free Markdown text about the topic (the `# Notes` section of the map file). Absent when empty. */
    note?: string;
}

/** Normalized, immutable mind map. Every operation returns a new tree. */
export interface MindMapTree {
    rootId: NodeId;
    nodes: Record<NodeId, MindNode>;
}

/** Nested, human-friendly description of a map (maps 1:1 to a Markdown list later). */
export interface Outline {
    text: string;
    collapsed?: boolean;
    note?: string;
    children?: Outline[];
}

/**
 * - `mindmap`: balanced, branches on both sides of the central topic
 * - `logic`: all branches to the right (XMind "Logic Chart")
 * - `org`: top-down (XMind "Org Chart")
 */
export type LayoutKind = 'mindmap' | 'logic' | 'org';

/** Direction in which a node's children grow. */
export type Side = 'right' | 'left' | 'down';
