import {exportFileName, exportMarkdown, importMarkdown} from './importExport';
import {NOT_A_MIND_MAP} from './mapFile/parse';
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

    it('refuses a Markdown file without the mindmap: 1 flag', () => {
        const notMap = {ok: false, error: NOT_A_MIND_MAP};
        expect(importMarkdown('- Root\n  - A\n', createTree())).toEqual(notMap);
        expect(importMarkdown('---\ntitle: x\n---\n\n# Map\n\n- A\n', createTree())).toEqual(notMap);
        expect(importMarkdown('# Map\n\n---\nmindmap: 1\n---\n', createTree())).toEqual(notMap);
    });

    it('reports a parse error for a mind map file without a "# Map" section', () => {
        expect(importMarkdown('---\nmindmap: 1\n---\n\n# Notes\n', createTree())).toEqual({
            ok: false,
            error: 'Line 1: The file must have exactly one "# Map" section.',
        });
    });

    it('reports other parse errors of a mind map file', () => {
        const result = importMarkdown('---\nmindmap: 1\n---\n\n# Map\n\n- A\n- B\n', createTree());
        expect(result.ok).toBe(false);
    });

    it('derives file names', () => {
        expect(exportFileName(createTree('a/b: c?'))).toBe('a b c.md');
        expect(exportFileName(createTree('  '))).toBe('mindmap.md');
    });
});
