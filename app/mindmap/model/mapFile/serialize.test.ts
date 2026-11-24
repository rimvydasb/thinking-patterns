import fs from 'node:fs';
import path from 'node:path';
import {fromOutline} from '../tree';
import type {Outline} from '../types';
import {escapeTopicLine, unescapeTopicLine} from './escape';
import {parseMapFile} from './parse';
import {newMapFileModel, serializeMapFile} from './serialize';
import type {MapFileModel} from './types';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const validSamples = fs
    .readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.map.md') && !f.includes('.canonical.'))
    .filter((f) => JSON.parse(read(f.replace('.map.md', '.expected.json'))).ok);

const canonicalOf = (name: string) => {
    const canonical = name.replace('.map.md', '.canonical.map.md');
    return fs.existsSync(path.join(FIXTURES, canonical)) ? read(canonical) : read(name);
};

const model = (outline: Outline, extra: Partial<MapFileModel> = {}): MapFileModel => ({
    ...newMapFileModel(),
    tree: fromOutline(outline),
    ...extra,
});

const roundTrip = (text: string) => {
    const r = parseMapFile(text);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    return serializeMapFile(r.model);
};

describe('serializeMapFile', () => {
    it.each(validSamples)('writes %s in its expected canonical form', (name) => {
        expect(roundTrip(read(name))).toBe(canonicalOf(name));
    });

    it.each(validSamples)('round-trips the canonical form of %s byte for byte', (name) => {
        const canonical = canonicalOf(name);
        expect(roundTrip(canonical)).toBe(canonical);
    });

    it('writes a new map with frontmatter, the central topic and a final newline', () => {
        expect(serializeMapFile(newMapFileModel())).toBe('---\nmindmap: 1\n---\n\n# Map\n\n- Central Topic\n');
    });

    it('does not write the folded state', () => {
        const text = serializeMapFile(model({text: 'A', collapsed: true, children: [{text: 'B'}]}));
        expect(text).toBe('---\nmindmap: 1\n---\n\n# Map\n\n- A\n  - B\n');
    });

    it('names a note by its topic text, or by the shortest unique path', () => {
        const text = serializeMapFile(
            model({
                text: 'Plan',
                children: [
                    {text: 'Product', children: [{text: 'Risks', note: 'Scope creep.'}]},
                    {text: 'Marketing', note: 'Reach.', children: [{text: 'Risks'}]},
                ],
            }),
        );
        expect(text).toContain('# Notes\n\n## Product > Risks\n\nScope creep.\n\n## Marketing\n\nReach.\n');
    });

    it('escapes topic text that would read as Markdown structure, and the parser restores it', () => {
        const texts = [
            '- dash',
            '# hash',
            '> quote',
            '1. one',
            '2) two',
            '***',
            '```',
            '+ plus',
            'a\n- b\n===',
            '*em*',
        ];
        const tree = {text: 'Root', children: texts.map((text) => ({text}))};
        const text = serializeMapFile(model(tree));
        expect(text).toContain('  - \\- dash\n  - \\# hash\n  - \\> quote\n  - 1\\. one\n  - 2\\) two\n');
        expect(text).toContain('  - a\n    \\- b\n    \\===\n  - *em*\n');
        const r = parseMapFile(text);
        if (!r.ok) throw new Error('parse failed');
        const root = r.model.tree.nodes[r.model.tree.rootId];
        expect(root.children.map((id) => r.model.tree.nodes[id].text)).toEqual(texts);
    });

    it('escapes reversibly', () => {
        for (const line of ['- a', '\\- a', '\\\\- a', '1. x', 'plain', '\\plain', '#hashtag', '---', '___']) {
            expect(unescapeTopicLine(escapeTopicLine(line))).toBe(line);
        }
    });

    it('writes orphan notes after the topic notes and other sections last', () => {
        const text = serializeMapFile(
            model(
                {text: 'A', note: 'Root note.'},
                {orphanNotes: [{heading: 'Gone', body: 'Old.'}], extraSections: '# References\n\n- x'},
            ),
        );
        expect(text).toBe(
            '---\nmindmap: 1\n---\n\n# Map\n\n- A\n\n# Notes\n\n## A\n\nRoot note.\n\n## Gone\n\nOld.\n\n# References\n\n- x\n',
        );
    });
});
