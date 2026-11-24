import {markdownToOutlines, outlineToMarkdown} from './markdown';
import type {Outline} from './types';

describe('markdown outlines', () => {
    const outline: Outline = {
        text: 'Root',
        children: [{text: 'A', children: [{text: 'A1\nsecond line'}]}, {text: 'B'}],
    };

    it('writes a nested list with two spaces per level', () => {
        expect(outlineToMarkdown(outline)).toBe('- Root\n  - A\n    - A1\n      second line\n  - B');
    });

    it('round-trips', () => {
        expect(markdownToOutlines(outlineToMarkdown(outline))).toEqual([outline]);
    });

    it('accepts other bullets, tabs, numbers and uneven indentation', () => {
        const md = '* One\n\t+ Two\n\t   1. Three\n   - Four\n- Five';
        expect(markdownToOutlines(md)).toEqual([
            {text: 'One', children: [{text: 'Two', children: [{text: 'Three'}]}, {text: 'Four'}]},
            {text: 'Five'},
        ]);
    });

    it('uses a heading as a top-level item and ignores stray text', () => {
        expect(markdownToOutlines('# Title\nintro\n- A\n  - B\n\n## Other\n- C')).toEqual([
            {text: 'Title', children: [{text: 'A', children: [{text: 'B'}]}]},
            {text: 'Other', children: [{text: 'C'}]},
        ]);
    });
});
