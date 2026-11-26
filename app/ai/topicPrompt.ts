import {getNode, pathTo} from '../mindmap/model/tree';
import type {MindMapTree, NodeId} from '../mindmap/model/types';
import {MAX_LIST_TOPICS} from './settings';

const MAX_LISTED = 40;

function quoteList(texts: string[]): string {
    return texts.length
        ? texts
              .slice(0, MAX_LISTED)
              .map((t) => `- ${t}`)
              .join('\n')
        : '(none yet)';
}

/**
 * The user message that asks for the name of topic `id` (a new, still empty topic). The context is the path from the
 * central topic to its parent, the topics already next to it and the parent's own siblings.
 * `isPending` tells which topics have no name yet; they are left out.
 */
export function buildTopicRequest(
    tree: MindMapTree,
    id: NodeId,
    isPending: (id: NodeId) => boolean,
    list = false,
): string {
    const node = getNode(tree, id);
    if (node.parentId === null) throw new Error('The central topic has no parent to brainstorm under.');
    const parent = getNode(tree, node.parentId);
    const named = (ids: NodeId[]) => ids.filter((c) => c !== id && !isPending(c)).map((c) => getNode(tree, c).text);

    const path = pathTo(tree, parent.id).map((p) => getNode(tree, p).text);
    const siblings = named(parent.children);
    const lines = [`Mind map path: ${path.join(' > ')}`];
    if (parent.parentId !== null) {
        const related = named(getNode(tree, parent.parentId).children.filter((c) => c !== parent.id));
        if (related.length) lines.push(`Topics next to "${parent.text}":\n${quoteList(related)}`);
    }
    lines.push(`Existing topics under "${parent.text}":\n${quoteList(siblings)}`);
    lines.push(
        list
            ? `List up to ${MAX_LIST_TOPICS} subtopics of "${parent.text}", one per line (fewer if fewer make sense).`
            : siblings.length
              ? `Give one more topic under "${parent.text}" that fits with the existing ones.`
              : `Give one topic under "${parent.text}".`,
    );
    return lines.join('\n\n');
}

/** Turns a model answer into a topic name: first line, no list marker, quotes or final full stop. */
export function cleanTopicAnswer(answer: string): string {
    const line = answer
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (!line) return '';
    return line
        .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
        .replace(/^(?:topic|answer)\s*:\s*/i, '')
        .replace(/^["'“”‘’`*]+|["'“”‘’`*]+$/g, '')
        .replace(/\.$/, '')
        .trim()
        .slice(0, 120);
}

/** Turns a list answer into topic names: one per line, cleaned, without duplicates or `existing` names. */
export function cleanTopicList(answer: string, existing: readonly string[] = []): string[] {
    const seen = new Set(existing.map((t) => t.trim().toLowerCase()));
    const out: string[] = [];
    for (const line of answer.split('\n')) {
        const text = cleanTopicAnswer(line);
        const key = text.toLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length === MAX_LIST_TOPICS) break;
    }
    return out;
}
