import {pathTo} from './tree';
import type {MindMapTree, NodeId} from './types';

/**
 * Names and paths of topics, as agents (MCP tools) and note headings in the map file use them.
 * - A name is the topic text. It identifies a topic only while exactly one topic has that text.
 * - A path is the topic texts from an ancestor down to the topic. The full path from the central topic always
 *   matches; a shorter trailing part matches while it is unique.
 * Matching ignores case and whitespace (see `normalize`).
 */

/** Comparison form of topic text: case and whitespace do not matter. */
export function normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Topic texts from the central topic to the topic. */
export function topicPath(tree: MindMapTree, id: NodeId): string[] {
    return pathTo(tree, id).map((p) => tree.nodes[p].text);
}

/** True if the last `path.length` topics of the topic's path have the texts in `path`. */
export function matchesPath(tree: MindMapTree, id: NodeId, path: readonly string[]): boolean {
    const full = pathTo(tree, id);
    if (full.length < path.length) return false;
    const tail = full.slice(full.length - path.length);
    return tail.every((nid, i) => normalize(tree.nodes[nid].text) === normalize(path[i]));
}

/** Topics whose text equals `name`. */
export function findByName(tree: MindMapTree, name: string): NodeId[] {
    const want = normalize(name);
    return Object.keys(tree.nodes).filter((id) => normalize(tree.nodes[id].text) === want);
}

/** Topics whose path ends with `path`. */
export function findByPath(tree: MindMapTree, path: readonly string[]): NodeId[] {
    return Object.keys(tree.nodes).filter((id) => matchesPath(tree, id, path));
}

/**
 * The shortest trailing path that matches only this topic, or the full path when none is unique (two siblings with
 * the same text).
 */
export function shortestUniquePath(tree: MindMapTree, id: NodeId): string[] {
    const full = topicPath(tree, id);
    for (let k = 1; k < full.length; k++) {
        const tail = full.slice(full.length - k);
        if (findByPath(tree, tail).length === 1) return tail;
    }
    return full;
}
