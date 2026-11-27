import {markdownToOutlines} from './markdown';
import {parseMapFile} from './mapFile/parse';
import {reconcileTrees} from './mapFile/reconcile';
import {serializeMapFile} from './mapFile/serialize';
import {DEFAULT_FRONTMATTER} from './mapFile/types';
import {fromOutline} from './tree';
import type {MindMapTree, Outline} from './types';

/** The current map as `.map.md` text (format v1: topics and notes). Pure, runs in the browser. */
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
    return `${base || 'mindmap'}.map.md`;
}

export type ImportResult = {ok: true; tree: MindMapTree} | {ok: false; error: string};

/**
 * Reads Markdown into a map that replaces `current`. Accepted input:
 * 1. A `.map.md` file (`# Map` section, optional `# Notes`).
 * 2. Any other Markdown list or headings (see `markdownToOutlines`). Several top-level items go under a central topic
 *    named `title`.
 * The result keeps the ids of `current` where topics match (`reconcileTrees`), so the import is one undo step and
 * syncs as a normal change.
 */
export function importMarkdown(text: string, current: MindMapTree, title = 'Central Topic'): ImportResult {
    const parsed = parseMapFile(text);
    if (parsed.ok) return {ok: true, tree: reconcileTrees(current, parsed.model.tree)};

    // Only fall back to the plain list reader for files that are not map files.
    if (/^#\s+Map\s*$/m.test(text)) {
        const first = parsed.diagnostics.find((d) => d.severity === 'error');
        return {ok: false, error: first ? `Line ${first.line}: ${first.message}` : 'The map file is not valid.'};
    }

    const outlines = markdownToOutlines(text);
    if (!outlines.length) return {ok: false, error: 'The file contains no list items or headings.'};
    const outline: Outline = outlines.length === 1 ? outlines[0] : {text: title, children: outlines};
    return {ok: true, tree: reconcileTrees(current, fromOutline(outline))};
}

/** Title for a map imported from `fileName`: the name without `.map.md` / `.md` / `.markdown`. */
export function titleFromFileName(fileName: string): string {
    return fileName.replace(/(\.map)?\.(md|markdown|txt)$/i, '').trim() || 'Central Topic';
}
