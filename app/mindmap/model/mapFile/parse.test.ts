import fs from 'node:fs';
import path from 'node:path';
import {toOutline} from '../tree';
import {parseMapFile} from './parse';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const samples = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.map.md') && !f.includes('.canonical.'));

/** Parses a file built from lines, with the frontmatter in front. */
const parse = (...lines: string[]) => parseMapFile(['---', 'mindmap: 1', '---', '', ...lines, ''].join('\n'));
const errors = (r: ReturnType<typeof parseMapFile>) =>
    r.diagnostics.filter((d) => d.severity === 'error').map((d) => [d.line, d.message]);

describe('parseMapFile', () => {
    it.each(samples)('parses %s as its golden fixture describes', (name) => {
        const expected = JSON.parse(read(name.replace('.map.md', '.expected.json')));
        const r = parseMapFile(read(name));
        const actual = r.ok
            ? {
                  ok: true,
                  outline: toOutline(r.model.tree),
                  frontmatter: r.model.frontmatter,
                  extraSections: r.model.extraSections,
                  orphanNotes: r.model.orphanNotes,
                  diagnostics: r.diagnostics,
              }
            : r;
        expect(actual).toEqual(expected);
    });

    it('reports every Git conflict marker line and returns no model', () => {
        const r = parseMapFile(read('conflict-markers.map.md'));
        expect(r.ok).toBe(false);
        expect(r.diagnostics.map((d) => d.line)).toEqual([8, 10, 12]);
    });

    it('assigns random ids, including the root', () => {
        const a = parse('# Map', '', '- A', '  - B');
        const b = parse('# Map', '', '- A', '  - B');
        if (!a.ok || !b.ok) throw new Error('parse failed');
        expect(a.model.tree.rootId).not.toBe('root');
        expect(a.model.tree.rootId).not.toBe(b.model.tree.rootId);
    });

    it('keeps inline Markdown and escapes of topic text as written', () => {
        const r = parse('# Map', '', '- Root', '  - **bold** \\*not emphasis\\* `code` [link](x)');
        if (!r.ok) throw new Error('parse failed');
        expect(toOutline(r.model.tree).children![0].text).toBe('**bold** \\*not emphasis\\* `code` [link](x)');
    });

    it('requires the mindmap: 1 frontmatter', () => {
        expect(errors(parseMapFile('# Map\n\n- A\n'))).toEqual([
            [1, 'The file must start with frontmatter that contains "mindmap: 1".'],
        ]);
        expect(errors(parseMapFile('---\nmindmap: true\n---\n\n# Map\n\n- A\n'))).toEqual([
            [1, 'The frontmatter must contain "mindmap: 1".'],
        ]);
    });

    it('rejects a map with several top-level items', () => {
        expect(errors(parse('# Map', '', '- A', '- B'))).toEqual([
            [8, '"# Map" must hold exactly one top-level item: the central topic. Indent the main topics under it.'],
        ]);
    });

    it('rejects text in # Map that is not in a list item', () => {
        expect(errors(parse('# Map', '', 'Intro', '', '- A'))).toEqual([
            [7, 'Text in "# Map" that is not in a list item. Write each topic as "- Topic".'],
        ]);
    });

    it('rejects a second paragraph in a topic', () => {
        expect(errors(parse('# Map', '', '- A', '', '  More text'))).toEqual([
            [9, 'A topic holds one paragraph of text and its subtopics. Move longer text into a note under "# Notes".'],
        ]);
    });

    it('rejects text before the first section and a second # Notes', () => {
        expect(errors(parse('Hello', '', '# Map', '', '- A'))).toEqual([
            [5, 'Text before the first "#" heading. Move it into a section.'],
        ]);
        expect(errors(parse('# Map', '', '- A', '', '# Notes', '', '# Notes'))).toEqual([
            [11, 'The file must have at most one "# Notes" section.'],
        ]);
    });

    it('matches note headings by name or trailing path, ignoring case and whitespace', () => {
        const r = parse(
            '# Map',
            '',
            '- Root',
            '  - A',
            '    - X',
            '  - B',
            '',
            '# Notes',
            '',
            '## a  >  x',
            '',
            'note',
        );
        if (!r.ok) throw new Error('parse failed');
        expect(toOutline(r.model.tree).children![0].children![0].note).toBe('note');
    });

    it('matches a unique topic text that contains ">" as a whole', () => {
        const r = parse('# Map', '', '- Root', '  - A > B', '', '# Notes', '', '## A > B', '', 'note');
        if (!r.ok) throw new Error('parse failed');
        expect(toOutline(r.model.tree).children![0].note).toBe('note');
    });

    it('reads CRLF line endings and a byte order mark', () => {
        const r = parseMapFile('﻿---\r\nmindmap: 1\r\n---\r\n\r\n# Map\r\n\r\n- A\r\n  - B\r\n');
        if (!r.ok) throw new Error('parse failed');
        expect(toOutline(r.model.tree)).toEqual({text: 'A', children: [{text: 'B'}]});
    });
});
