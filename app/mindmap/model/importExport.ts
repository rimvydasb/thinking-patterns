import {isMindMapFile, NOT_A_MIND_MAP, parseMapFile} from './mapFile/parse';
import {reconcileTrees} from './mapFile/reconcile';
import {serializeMapFile} from './mapFile/serialize';
import {DEFAULT_FRONTMATTER} from './mapFile/types';
import type {MindMapTree} from './types';

/** The current map as map-file Markdown (format v1: topics and notes). Pure, runs in the browser. */
export function exportMarkdown(tree: MindMapTree): string {
    return serializeMapFile({tree, frontmatter: DEFAULT_FRONTMATTER, extraSections: '', orphanNotes: []});
}

/** File name for an export: the central topic text, made safe for file systems. */
export function exportFileName(tree: MindMapTree): string {
    const base = [...tree.nodes[tree.rootId].text]
        .map((c) => (c < ' ' ? ' ' : c))
        .join('')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return `${base || 'mindmap'}.md`;
}

export type ImportResult = {ok: true; tree: MindMapTree} | {ok: false; error: string};

/**
 * Reads a mind map file into a map that replaces `current`. The same rules apply as when the server opens a file:
 * 1. The file must have the `mindmap: 1` frontmatter flag, else it is not a mind map file.
 * 2. It must then parse as a map file (`# Map` section, optional `# Notes`), else the first parse error is returned.
 * The result keeps the ids of `current` where topics match (`reconcileTrees`), so the import is one undo step and
 * syncs as a normal change.
 */
export function importMarkdown(text: string, current: MindMapTree): ImportResult {
    if (!isMindMapFile(text)) return {ok: false, error: NOT_A_MIND_MAP};
    const parsed = parseMapFile(text);
    if (parsed.ok) return {ok: true, tree: reconcileTrees(current, parsed.model.tree)};
    const first = parsed.diagnostics.find((d) => d.severity === 'error');
    return {ok: false, error: first ? `Line ${first.line}: ${first.message}` : 'The map file is not valid.'};
}
