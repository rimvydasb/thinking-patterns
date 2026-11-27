import {iconToken} from '../icons';
import {createTree} from '../tree';
import {shortestUniquePath} from '../topicPath';
import type {MindMapTree, NodeId} from '../types';
import {escapeTopicLine} from './escape';
import {DEFAULT_FRONTMATTER, type MapFileModel} from './types';

/**
 * Writes the canonical form of a map file: LF line endings, a final newline, `-` bullets, 2 spaces per level, notes in
 * pre-order of the tree, then orphan notes, then the other sections. Icons are `:shortcode:` tokens in front of the
 * topic text (`- :one: :star: Topic`). `collapsed` is a view state and is not written.
 * Deterministic: the same model always gives the same text.
 */
export function serializeMapFile(model: MapFileModel): string {
    const {tree} = model;
    const blocks: string[] = [`---\n${model.frontmatter.replace(/\r\n?/g, '\n')}\n---`, '# Map', mapList(tree)];

    const notes: string[] = [];
    preOrder(tree).forEach((id) => {
        const note = tree.nodes[id].note;
        if (note) notes.push(`## ${shortestUniquePath(tree, id).map(headingPart).join(' > ')}\n\n${note}`);
    });
    for (const o of model.orphanNotes) notes.push(o.body ? `## ${o.heading}\n\n${o.body}` : `## ${o.heading}`);
    if (notes.length) blocks.push('# Notes', ...notes);

    if (model.extraSections.trim()) blocks.push(model.extraSections.trim());
    return `${blocks.join('\n\n').replace(/\r\n?/g, '\n')}\n`;
}

/** A new map file with only the central topic. */
export function newMapFileModel(rootText = 'Central Topic', rootId?: NodeId): MapFileModel {
    return {tree: createTree(rootText, rootId), frontmatter: DEFAULT_FRONTMATTER, extraSections: '', orphanNotes: []};
}

function preOrder(tree: MindMapTree): NodeId[] {
    const out: NodeId[] = [];
    const visit = (id: NodeId) => {
        out.push(id);
        tree.nodes[id].children.forEach(visit);
    };
    visit(tree.rootId);
    return out;
}

/** Topic text on one heading line. */
const headingPart = (text: string) => text.replace(/\s+/g, ' ').trim();

function mapList(tree: MindMapTree): string {
    const lines: string[] = [];
    const visit = (id: NodeId, depth: number) => {
        const pad = '  '.repeat(depth);
        const [first = '', ...rest] = tree.nodes[id].text
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l);
        const icons = (tree.nodes[id].icons ?? []).map((c) => `${iconToken(c)} `).join('');
        lines.push(`${pad}- ${icons}${escapeTopicLine(first)}`);
        for (const line of rest) lines.push(`${pad}  ${escapeTopicLine(line)}`);
        tree.nodes[id].children.forEach((c) => visit(c, depth + 1));
    };
    visit(tree.rootId, 0);
    return lines.join('\n');
}
