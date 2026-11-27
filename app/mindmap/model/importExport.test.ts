import {exportFileName, exportMarkdown, importMarkdown, titleFromFileName} from './importExport';
import {createTree, fromOutline, toOutline} from './tree';

describe('markdown import / export', () => {
    const tree = fromOutline({
        text: 'Plan',
        children: [{text: 'Build', note: 'Steps.', children: [{text: 'Pipeline'}]}, {text: 'Ship'}],
    });

    it('exports a map file with topics and notes', () => {
        expect(exportMarkdown(tree)).toBe(
            '---\nmindmap: 1\n---\n\n# Map\n\n- Plan\n  - Build\n    - Pipeline\n  - Ship\n\n# Notes\n\n## Build\n\nSteps.\n',
        );
    });

    it('round-trips an export and keeps the ids of matching topics', () => {
        const result = importMarkdown(exportMarkdown(tree), tree);
        expect(result.ok && result.tree).toEqual(tree);
    });

    it('keeps the root id of the current map', () => {
        const current = createTree('Old', 'abc');
        const result = importMarkdown(exportMarkdown(tree), current);
        expect(result.ok && result.tree.rootId).toBe('abc');
        expect(result.ok && toOutline(result.tree)).toEqual(toOutline(tree));
    });

    it('imports a plain Markdown list', () => {
        const result = importMarkdown('- Root\n  - A\n  - B\n', createTree());
        expect(result.ok && toOutline(result.tree)).toEqual({text: 'Root', children: [{text: 'A'}, {text: 'B'}]});
    });

    it('puts several top-level items under a central topic named after the file', () => {
        const result = importMarkdown('# One\n- A\n# Two\n', createTree(), 'Notes');
        expect(result.ok && toOutline(result.tree)).toEqual({
            text: 'Notes',
            children: [{text: 'One', children: [{text: 'A'}]}, {text: 'Two'}],
        });
    });

    it('reports an invalid map file', () => {
        const result = importMarkdown('# Map\n\n- A\n- B\n', createTree());
        expect(result.ok).toBe(false);
    });

    it('reports a file without topics', () => {
        expect(importMarkdown('just text\n', createTree())).toEqual({
            ok: false,
            error: 'The file contains no list items or headings.',
        });
    });

    it('derives file names', () => {
        expect(exportFileName(createTree('a/b: c?'))).toBe('a b c.map.md');
        expect(exportFileName(createTree('  '))).toBe('mindmap.map.md');
        expect(titleFromFileName('Ideas.map.md')).toBe('Ideas');
        expect(titleFromFileName('notes.markdown')).toBe('notes');
    });
});
