import type {Heading, List, ListItem, Root, RootContent} from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import {unified} from 'unified';
import {splitLeadingIcons} from '../icons';
import {findByName, findByPath, normalize} from '../topicPath';
import {newId} from '../tree';
import type {MindMapTree, MindNode, NodeId} from '../types';
import {unescapeTopicLine} from './escape';
import {readLayout} from './frontmatter';
import type {Diagnostic, MapFileModel, OrphanNote, ParseResult} from './types';

/**
 * Reads a `.map.md` file (format v1). `remark-parse` builds the Markdown tree with the CommonMark rules that GitHub
 * and editors render with; topic and note text is copied from the file by the node offsets, so inline Markdown and
 * escapes stay as the user wrote them. Pure, never throws.
 */
export function parseMapFile(input: string): ParseResult {
    const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const diagnostics: Diagnostic[] = [];
    const error = (line: number, message: string) => diagnostics.push({line, severity: 'error', message});

    conflictMarkers(text).forEach((line) => error(line, 'Git conflict marker. Resolve the merge conflict first.'));
    if (diagnostics.length) return {ok: false, diagnostics};

    let root: Root;
    try {
        root = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(text);
    } catch (err) {
        return {ok: false, diagnostics: [{line: 1, severity: 'error', message: `Cannot read the file: ${err}`}]};
    }
    const reader = new Reader(text, error);
    const model = reader.read(root);
    diagnostics.push(...reader.warnings);
    diagnostics.sort((a, b) => a.line - b.line);
    if (!model || diagnostics.some((d) => d.severity === 'error')) return {ok: false, diagnostics};
    return {ok: true, model, diagnostics};
}

/** Shown when a Markdown file has no `mindmap: 1` frontmatter flag. */
export const NOT_A_MIND_MAP = 'This is not a mind map file: it has no "mindmap: 1" flag in its frontmatter.';

/**
 * True if the text starts with frontmatter that holds the `mindmap: 1` flag. Only such Markdown files are mind map
 * files; any other Markdown file is refused before parsing. A mind map file without a `# Map` section is a parse
 * error (`parseMapFile`).
 */
export function isMindMapFile(input: string): boolean {
    const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const front = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
    return !!front && /^mindmap:[ \t]*1[ \t]*$/m.test(front[1]);
}

const CONFLICT = /^(?:<{7}|>{7})(?:\s|$)|^(?:={7}|\|{7})(?:\s|$)/;

/** Lines with Git conflict markers. CommonMark reads them as text or a setext underline, so they are checked raw. */
function conflictMarkers(text: string): number[] {
    const lines: number[] = [];
    text.split('\n').forEach((l, i) => {
        if (CONFLICT.test(l)) lines.push(i + 1);
    });
    return lines;
}

const lineOf = (node: {position?: {start: {line: number}}}) => node.position?.start.line ?? 1;
const startOf = (node: RootContent) => node.position!.start.offset!;
const endOf = (node: RootContent) => node.position!.end.offset!;

interface Section {
    heading: Heading;
    title: string;
    content: RootContent[];
    /** Offset where the next `#` section (or the file) ends. */
    end: number;
}

interface PendingNote {
    heading: string;
    body: string;
    line: number;
}

class Reader {
    readonly warnings: Diagnostic[] = [];
    private readonly nodes: Record<NodeId, MindNode> = {};

    constructor(
        private readonly text: string,
        private readonly error: (line: number, message: string) => void,
    ) {}

    read(root: Root): MapFileModel | null {
        const [first, ...rest] = root.children;
        if (first?.type !== 'yaml') {
            this.error(1, 'The file must start with frontmatter that contains "mindmap: 1".');
            return null;
        }
        if (!/^mindmap:[ \t]*1[ \t]*$/m.test(first.value)) {
            this.error(lineOf(first), 'The frontmatter must contain "mindmap: 1".');
            return null;
        }

        const sections = this.sections(rest);
        if (!sections) return null;
        const maps = sections.filter((s) => s.title === 'map');
        const notes = sections.filter((s) => s.title === 'notes');
        if (maps.length !== 1) {
            this.error(maps[1] ? lineOf(maps[1].heading) : 1, 'The file must have exactly one "# Map" section.');
            return null;
        }
        if (notes.length > 1) {
            this.error(lineOf(notes[1].heading), 'The file must have at most one "# Notes" section.');
            return null;
        }

        const tree = this.readMap(maps[0]);
        if (!tree) return null;
        const {layout, error} = readLayout(first.value);
        if (layout) tree.layout = layout;
        if (error) this.warnings.push({line: lineOf(first), severity: 'warning', message: error});
        const pending = notes.length ? this.readNotes(notes[0]) : [];
        const orphanNotes = this.attachNotes(tree, pending);
        const extraSections = sections
            .filter((s) => s.title !== 'map' && s.title !== 'notes')
            .map((s) => this.text.slice(startOf(s.heading), s.end).replace(/\s+$/, ''))
            .join('\n\n');
        return {tree, frontmatter: first.value, extraSections, orphanNotes};
    }

    /** Splits the content after the frontmatter at `#` headings. */
    private sections(children: RootContent[]): Section[] | null {
        const sections: Section[] = [];
        for (const node of children) {
            if (node.type === 'heading' && node.depth === 1) {
                if (sections.length) sections[sections.length - 1].end = startOf(node);
                sections.push({
                    heading: node,
                    title: normalize(this.inlineText(node)),
                    content: [],
                    end: this.text.length,
                });
            } else if (sections.length) {
                sections[sections.length - 1].content.push(node);
            } else {
                this.error(lineOf(node), 'Text before the first "#" heading. Move it into a section.');
                return null;
            }
        }
        return sections;
    }

    /** Source text of a heading or paragraph without its markers. */
    private inlineText(node: Heading | {children: RootContent[]}): string {
        const kids = node.children as RootContent[];
        if (!kids.length) return '';
        return this.text.slice(startOf(kids[0]), endOf(kids[kids.length - 1]));
    }

    private readMap(section: Section): MindMapTree | null {
        const lists = section.content.filter((n): n is List => n.type === 'list');
        const other = section.content.find((n) => n.type !== 'list');
        if (other) {
            this.error(lineOf(other), 'Text in "# Map" that is not in a list item. Write each topic as "- Topic".');
            return null;
        }
        const items = lists.flatMap((l) => l.children);
        if (items.length !== 1) {
            this.error(
                items[1] ? lineOf(items[1]) : lineOf(section.heading),
                '"# Map" must hold exactly one top-level item: the central topic. Indent the main topics under it.',
            );
            return null;
        }
        const rootId = this.readTopic(items[0], null);
        return rootId ? {rootId, nodes: this.nodes} : null;
    }

    private readTopic(item: ListItem, parentId: NodeId | null): NodeId | null {
        const [first, ...rest] = item.children;
        if (first && first.type !== 'paragraph') {
            this.error(lineOf(first), 'A topic must start with its text, for example "- Topic".');
            return null;
        }
        const extra = rest.find((n) => n.type !== 'list');
        if (extra) {
            this.error(
                lineOf(extra),
                'A topic holds one paragraph of text and its subtopics. Move longer text into a note under "# Notes".',
            );
            return null;
        }
        const {icons, text} = first ? this.topicText(first) : {icons: [], text: ''};
        if (!text) {
            this.error(lineOf(item), 'Empty topic. Write the topic text after the bullet.');
            return null;
        }
        const id = newId();
        const node: MindNode = {id, text, parentId, children: [], ...(icons.length ? {icons} : {})};
        this.nodes[id] = node;
        for (const list of rest as List[]) {
            for (const child of list.children) {
                const childId = this.readTopic(child, id);
                if (!childId) return null;
                node.children.push(childId);
            }
        }
        return id;
    }

    /**
     * Paragraph source with the leading icon tokens split off, and the continuation indentation and the
     * serializer's escapes removed.
     */
    private topicText(paragraph: {children: RootContent[]}): {icons: string[]; text: string} {
        const [first = '', ...rest] = this.inlineText(paragraph).split('\n');
        const {icons, text} = splitLeadingIcons(first.trim());
        return {
            icons,
            text: [text, ...rest]
                .map((l) => unescapeTopicLine(l.trim()))
                .filter((l) => l)
                .join('\n'),
        };
    }

    private readNotes(section: Section): PendingNote[] {
        const notes: PendingNote[] = [];
        const headings = section.content.filter((n): n is Heading => n.type === 'heading' && n.depth === 2);
        const before = section.content.find((n) => !headings.length || startOf(n) < startOf(headings[0]));
        if (before) {
            this.error(lineOf(before), 'Text in "# Notes" before the first "## <topic>" heading.');
            return notes;
        }
        headings.forEach((h, i) => {
            const end = i + 1 < headings.length ? startOf(headings[i + 1]) : section.end;
            const body = this.text
                .slice(endOf(h), end)
                .replace(/^[ \t]*\n(?:[ \t]*\n)*/, '')
                .replace(/\s+$/, '');
            notes.push({heading: this.inlineText(h), body, line: lineOf(h)});
        });
        return notes;
    }

    /** Puts each note on the topic its heading names. Returns the notes that name no topic. */
    private attachNotes(tree: MindMapTree, notes: PendingNote[]): OrphanNote[] {
        const orphans: OrphanNote[] = [];
        for (const note of notes) {
            const byName = findByName(tree, note.heading);
            const ids = byName.length === 1 ? byName : findByPath(tree, note.heading.split('>'));
            const warn = (message: string) => {
                this.warnings.push({line: note.line, severity: 'warning', message});
                orphans.push({heading: note.heading, body: note.body});
            };
            if (ids.length === 0) {
                warn(`Note "${note.heading}" matches no topic. Change its heading to the topic text.`);
            } else if (ids.length > 1) {
                warn(`Note "${note.heading}" matches ${ids.length} topics. Use a path such as "Parent > Topic".`);
            } else if (tree.nodes[ids[0]].note !== undefined) {
                warn(`Note "${note.heading}" names a topic that already has a note.`);
            } else if (note.body) {
                tree.nodes[ids[0]].note = note.body;
            }
        }
        return orphans;
    }
}
