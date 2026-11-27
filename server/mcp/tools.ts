import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {ICON_GROUPS, normalizeIcons} from '../../app/mindmap/model/icons';
import {markdownToOutlines} from '../../app/mindmap/model/markdown';
import {applyOps, diffTrees, outlineToOps, type MapOp} from '../../app/mindmap/model/ops';
import {newId, pathTo} from '../../app/mindmap/model/tree';
import type {MindMapTree, NodeId, Outline} from '../../app/mindmap/model/types';
import {normalize, topicPath} from '../../app/mindmap/model/topicPath';
import {MapError, type MapDocument} from '../map/mapDocument';
import {writesPausedMessage, type MapFileBinding} from '../map/mapFileBinding';
import type {MapWorkspace} from '../map/mapWorkspace';
import {iconsSchema, topicInputSchema} from '../map/schemas';
import {resolveTopic, resolveTopics, TOPIC_ARGS, type RefArgNames, type TopicRef} from './topicRef';

export const SERVER_INFO = {name: 'thinking-patterns', version: '0.1.0'};

const INSTRUCTIONS = `Thinking Patterns: edits the mind map the user has open. Changes appear live in the app.
Name a topic by its text ("topicName") while that text is unique. Otherwise use "topicPath": the topic texts from the
central topic down to the topic, for example ["Central Topic", "Product", "Risks"].
If a name matches several topics, the tool changes nothing and lists the paths to choose from.
Use get_selection to find the topic the user means by "this topic".
The map is stored in a Markdown file (see get_map_info). Change tools return after the file is written.`;

export const NO_FILE_MESSAGE = 'No map file is open. Ask the user to open one in the app.';

/** A topic as tools return it: text, icons, note and nested children. */
export interface TopicTree {
    text: string;
    icons?: string[];
    collapsed?: true;
    note?: string;
    children?: TopicTree[];
}

function topicTree(tree: MindMapTree, id: NodeId): TopicTree {
    const n = tree.nodes[id];
    const v: TopicTree = {text: n.text};
    if (n.icons?.length) v.icons = [...n.icons];
    if (n.collapsed) v.collapsed = true;
    if (n.note) v.note = n.note;
    if (n.children.length) v.children = n.children.map((c) => topicTree(tree, c));
    return v;
}

/** Topics from either the `topics` or the `markdown` argument. */
function readTopics(args: {topics?: Outline[]; markdown?: string}): Outline[] {
    if (args.topics && args.markdown !== undefined) throw new MapError('Give either "topics" or "markdown", not both.');
    if (args.topics) return args.topics;
    if (args.markdown !== undefined) {
        const parsed = markdownToOutlines(args.markdown);
        if (!parsed.length) throw new MapError('The Markdown has no list items. Use "- Topic" lines.');
        return parsed;
    }
    return [];
}

/** Names in `texts` that more than one topic of the map has (after the change). */
function sharedNames(tree: MindMapTree, texts: string[]): string[] {
    const counts = new Map<string, number>();
    for (const n of Object.values(tree.nodes)) counts.set(normalize(n.text), (counts.get(normalize(n.text)) ?? 0) + 1);
    return [...new Set(texts)].filter((t) => (counts.get(normalize(t)) ?? 0) > 1);
}

function json(data: unknown): CallToolResult {
    return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
}

/** Wraps a tool body: returns its value as JSON text, and errors (including ambiguity questions) as tool errors. */
async function run(body: () => unknown): Promise<CallToolResult> {
    try {
        return json(await body());
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {isError: true, content: [{type: 'text', text: message}]};
    }
}

const PATH_HELP = 'Topic texts from the central topic (or any unique ancestor) down to the topic.';

/** `<prefix>Name` and `<prefix>Path` arguments that reference one topic. */
function refArgs(args: RefArgNames, what: string) {
    return {
        [args.name]: z.string().optional().describe(`Text of ${what}. Works only if the text is unique.`),
        [args.path]: z.array(z.string()).min(1).optional().describe(`Path of ${what}. ${PATH_HELP}`),
    };
}

const topicRefSchema = z.object({
    topicName: z.string().optional().describe('Topic text. Works only if the text is unique.'),
    topicPath: z.array(z.string()).min(1).optional().describe(PATH_HELP),
});

type RefInput = Record<string, unknown>;
const refOf = (input: RefInput, args: RefArgNames): TopicRef => ({
    name: input[args.name] as string | undefined,
    path: input[args.path] as string[] | undefined,
});

const PARENT_ARGS: RefArgNames = {name: 'parentName', path: 'parentPath'};
const NEW_PARENT_ARGS: RefArgNames = {name: 'newParentName', path: 'newParentPath'};

const topicsArg = z.array(topicInputSchema).optional().describe('Nested topics: [{text, children?: [...]}].');
const markdownArg = z
    .string()
    .optional()
    .describe('Alternative to "topics": a Markdown list, one "- Topic" per line, 2 spaces of indent per level.');

const READ = {readOnlyHint: true, openWorldHint: false} as const;
const WRITE = {readOnlyHint: false, destructiveHint: false, openWorldHint: false} as const;
const DESTRUCTIVE = {readOnlyHint: false, destructiveHint: true, openWorldHint: false} as const;

/**
 * Registers all mind map tools on `server`. Every call works on the map file that is open at that moment
 * (`workspace.current()`); the wrappers below set `doc` right before the synchronous tool body runs.
 */
export function registerTools(server: McpServer, workspace: MapWorkspace) {
    let doc!: MapDocument;
    const open = (): MapFileBinding => {
        const binding = workspace.current();
        if (!binding) throw new MapError(NO_FILE_MESSAGE);
        doc = binding.doc;
        return binding;
    };
    /** A tool that reads the map, or changes only the view (folding, focus). */
    const read = (body: () => unknown) =>
        run(() => {
            open();
            return body();
        });
    /** A tool that changes the map: refused while writes are paused, returns after the file is written (D6, D10). */
    const change = (body: () => unknown) =>
        run(async () => {
            const binding = open();
            const {state} = binding.fileState();
            if (state === 'invalid' || state === 'missing')
                throw new MapError(writesPausedMessage(binding.fileState()));
            const result = body();
            await binding.flush();
            return result;
        });
    const topic = (input: RefInput, args = TOPIC_ARGS) => resolveTopic(doc.tree, refOf(input, args), args);
    const path = (id: NodeId) => topicPath(doc.tree, id);

    server.registerTool(
        'get_map_info',
        {
            title: 'Get map info',
            description:
                'Returns the Markdown file that stores the open map: its absolute path, its state (clean, writing, ' +
                'invalid, missing), parse errors and warnings, and the times of the last write and the last outside ' +
                'change. You MAY edit this file directly with file tools; the open app shows the change. Returns ' +
                '{"path": null} while no map file is open.',
            inputSchema: {},
            annotations: READ,
        },
        () =>
            run(() => {
                const binding = workspace.current();
                return binding ? binding.fileState() : {path: null};
            }),
    );

    server.registerTool(
        'list_icons',
        {
            title: 'List icons',
            description:
                'Returns the icons a topic can have, by group: shortcodes (use them in "icons") and emoji. A topic ' +
                'has at most one icon per group.',
            inputSchema: {},
            annotations: READ,
        },
        () => run(() => ICON_GROUPS.map((g) => ({group: g.label, icons: g.icons.map((i) => `${i.code} ${i.emoji}`)}))),
    );

    server.registerTool(
        'get_topic',
        {
            title: 'Get topic',
            description: 'Returns one topic with its path from the central topic, its note, and all its subtopics.',
            inputSchema: refArgs(TOPIC_ARGS, 'the topic'),
            annotations: READ,
        },
        (input) =>
            read(() => {
                const id = topic(input);
                return {path: path(id), topic: topicTree(doc.tree, id)};
            }),
    );

    server.registerTool(
        'search_topics',
        {
            title: 'Search topics',
            description:
                'Finds topics whose text contains "query" (case-insensitive), or matches it as a regex. ' +
                'Returns the path of each match.',
            inputSchema: {
                query: z.string().min(1),
                regex: z.boolean().optional().describe('Treat "query" as a JavaScript regular expression.'),
                limit: z.number().int().min(1).max(500).optional().describe('Default: 50.'),
            },
            annotations: READ,
        },
        (args) =>
            read(() => {
                let test: (s: string) => boolean;
                if (args.regex) {
                    let re: RegExp;
                    try {
                        re = new RegExp(args.query, 'i');
                    } catch (e) {
                        throw new MapError(`Invalid regex: ${(e as Error).message}`);
                    }
                    test = (s) => re.test(s);
                } else {
                    const q = args.query.toLowerCase();
                    test = (s) => s.toLowerCase().includes(q);
                }
                const all = Object.values(doc.tree.nodes).filter((n) => test(n.text));
                return {total: all.length, matches: all.slice(0, args.limit ?? 50).map((n) => path(n.id))};
            }),
    );

    server.registerTool(
        'get_selection',
        {
            title: 'Get selection',
            description: 'Returns the topic the user has selected in the app ("this topic"), or null.',
            inputSchema: {},
            annotations: READ,
        },
        () =>
            read(() => {
                const s = doc.selection;
                if (!s || !doc.tree.nodes[s.topicId]) return {selection: null};
                return {selection: {path: path(s.topicId), topic: topicTree(doc.tree, s.topicId), selectedAt: s.at}};
            }),
    );

    server.registerTool(
        'add_topics',
        {
            title: 'Add topics',
            description:
                'Adds one or more topics (with nested subtopics) under a parent in one change. ' +
                'Without a parent, the topics become main topics of the central topic. A folded parent is unfolded.',
            inputSchema: {
                ...refArgs(PARENT_ARGS, 'the parent topic (default: the central topic)'),
                topics: topicsArg,
                markdown: markdownArg,
                index: z.number().int().min(0).optional().describe('Position among the siblings. Default: last.'),
            },
            annotations: WRITE,
        },
        (input) =>
            change(() => {
                const ref = refOf(input, PARENT_ARGS);
                const parentId = ref.name || ref.path ? topic(input, PARENT_ARGS) : doc.tree.rootId;
                const parent = doc.tree.nodes[parentId];
                const topics = readTopics(input);
                if (!topics.length) throw new MapError('Give "topics" or "markdown".');
                const index = Math.min(input.index ?? parent.children.length, parent.children.length);
                const {ops, ids} = outlineToOps(topics, parentId, index, newId);
                if (parent.collapsed) ops.unshift({op: 'setCollapsed', id: parentId, collapsed: false});
                doc.apply(ops);
                const shared = sharedNames(
                    doc.tree,
                    ops.flatMap((op) => (op.op === 'add' ? [op.text] : [])),
                );
                return {
                    added: ids.map(path),
                    ...(shared.length ? {notUniqueNames: shared, note: 'Use topicPath for these names.'} : {}),
                };
            }),
    );

    server.registerTool(
        'update_topic',
        {
            title: 'Update topic',
            description: 'Changes the text, the icons or the note of a topic, folds it or unfolds it.',
            inputSchema: {
                ...refArgs(TOPIC_ARGS, 'the topic'),
                text: z.string().min(1).optional().describe('New text.'),
                icons: iconsSchema.optional().describe('New icons (replace all). An empty list removes them.'),
                collapsed: z.boolean().optional().describe('true folds the topic (hides its subtopics).'),
                note: z
                    .string()
                    .optional()
                    .describe('New Markdown note of the topic. An empty string removes the note.'),
            },
            annotations: WRITE,
        },
        (input) =>
            change(() => {
                const id = topic(input);
                if (
                    input.text === undefined &&
                    input.icons === undefined &&
                    input.collapsed === undefined &&
                    input.note === undefined
                ) {
                    throw new MapError('Give "text", "icons", "collapsed" or "note".');
                }
                if (input.collapsed && !doc.tree.nodes[id].children.length) {
                    throw new MapError('A topic without subtopics cannot fold.');
                }
                const ops: MapOp[] = [];
                if (input.text !== undefined) ops.push({op: 'setText', id, text: input.text});
                if (input.icons !== undefined) ops.push({op: 'setIcons', id, icons: normalizeIcons(input.icons)});
                if (input.collapsed !== undefined) ops.push({op: 'setCollapsed', id, collapsed: input.collapsed});
                if (input.note !== undefined) ops.push({op: 'setNote', id, note: input.note.trim()});
                doc.apply(ops);
                const n = doc.tree.nodes[id];
                return {
                    path: path(id),
                    collapsed: !!n.collapsed,
                    ...(n.icons?.length ? {icons: n.icons} : {}),
                    ...(n.note ? {note: n.note} : {}),
                };
            }),
    );

    server.registerTool(
        'move_topic',
        {
            title: 'Move topic',
            description: 'Moves a topic (with its subtopics) under another parent, or to another position.',
            inputSchema: {
                ...refArgs(TOPIC_ARGS, 'the topic to move'),
                ...refArgs(NEW_PARENT_ARGS, 'the new parent (give the current parent to reorder)'),
                index: z.number().int().min(0).optional().describe('Position among the new siblings. Default: last.'),
            },
            annotations: WRITE,
        },
        (input) =>
            change(() => {
                const id = topic(input);
                const parentId = topic(input, NEW_PARENT_ARGS);
                if (id === doc.tree.rootId) throw new MapError('The central topic cannot move.');
                if (pathTo(doc.tree, parentId).includes(id)) {
                    throw new MapError('A topic cannot move under itself or its own subtopics.');
                }
                const siblings = doc.tree.nodes[parentId].children.filter((c) => c !== id).length;
                const index = Math.min(input.index ?? siblings, siblings);
                doc.apply([{op: 'move', id, parentId, index}]);
                return {path: path(id), index};
            }),
    );

    server.registerTool(
        'delete_topics',
        {
            title: 'Delete topics',
            description: 'Deletes topics and all their subtopics. The central topic cannot be deleted.',
            inputSchema: {topics: z.array(topicRefSchema).min(1).describe('The topics to delete.')},
            annotations: DESTRUCTIVE,
        },
        (input) =>
            change(() => {
                const ids = resolveTopics(
                    doc.tree,
                    input.topics.map((t) => refOf(t, TOPIC_ARGS)),
                );
                if (ids.includes(doc.tree.rootId)) throw new MapError('The central topic cannot be deleted.');
                const paths = ids.map(path);
                const before = Object.keys(doc.tree.nodes).length;
                doc.apply(ids.map((id) => ({op: 'remove', id})));
                return {deleted: paths, deletedTopicCount: before - Object.keys(doc.tree.nodes).length};
            }),
    );

    server.registerTool(
        'group_topics',
        {
            title: 'Group topics',
            description:
                'Creates a new topic in place of the first given topic and moves the given sibling topics under it ' +
                '(XMind "Insert Parent Topic").',
            inputSchema: {
                topics: z.array(topicRefSchema).min(1).describe('Topics with the same parent, in the wanted order.'),
                text: z.string().min(1).describe('Text of the new parent topic.'),
            },
            annotations: WRITE,
        },
        (input) =>
            change(() => {
                const ids = resolveTopics(
                    doc.tree,
                    input.topics.map((t) => refOf(t, TOPIC_ARGS)),
                );
                const parentId = doc.tree.nodes[ids[0]].parentId;
                if (parentId === null) throw new MapError('The central topic cannot be grouped.');
                if (ids.some((id) => doc.tree.nodes[id].parentId !== parentId)) {
                    throw new MapError('All topics must have the same parent.');
                }
                const siblings = doc.tree.nodes[parentId].children;
                const index = Math.min(...ids.map((id) => siblings.indexOf(id)));
                const group = newId();
                const ops: MapOp[] = [{op: 'add', id: group, parentId, index, text: input.text}];
                ids.forEach((id, i) => ops.push({op: 'move', id, parentId: group, index: i}));
                doc.apply(ops);
                return {path: path(group), topic: topicTree(doc.tree, group)};
            }),
    );

    server.registerTool(
        'replace_map',
        {
            title: 'Replace map',
            description:
                'Replaces all topics of the map. In "markdown", one top-level item is the central topic; several ' +
                'top-level items become the main topics. "topics" are always main topics.',
            inputSchema: {
                title: z.string().min(1).optional().describe('New central topic text. Default: unchanged.'),
                topics: topicsArg,
                markdown: markdownArg,
            },
            annotations: DESTRUCTIVE,
        },
        (input) =>
            change(() => {
                let topics = readTopics(input);
                let title = input.title;
                if (input.markdown !== undefined && topics.length === 1) {
                    title ??= topics[0].text;
                    topics = topics[0].children ?? [];
                }
                const root = doc.tree.nodes[doc.tree.rootId];
                const empty: MindMapTree = {
                    rootId: root.id,
                    nodes: {[root.id]: {id: root.id, text: title ?? root.text, parentId: null, children: []}},
                };
                const target = applyOps(empty, outlineToOps(topics, root.id, 0, newId).ops).tree;
                doc.apply(diffTrees(doc.tree, target));
                return {topicCount: Object.keys(doc.tree.nodes).length, map: topicTree(doc.tree, doc.tree.rootId)};
            }),
    );

    server.registerTool(
        'focus_topic',
        {
            title: 'Focus topic',
            description: 'Selects a topic in the app and scrolls it into view. Unfolds folded ancestors.',
            inputSchema: refArgs(TOPIC_ARGS, 'the topic'),
            annotations: WRITE,
        },
        (input) =>
            read(() => {
                const id = topic(input);
                const ops: MapOp[] = pathTo(doc.tree, id)
                    .slice(0, -1)
                    .filter((a) => doc.tree.nodes[a].collapsed)
                    .map((a) => ({op: 'setCollapsed', id: a, collapsed: false}));
                if (ops.length) doc.apply(ops);
                doc.focus(id);
                return {path: path(id)};
            }),
    );
}

/** A new MCP server with all tools. One instance serves one transport (see routing.ts). */
export function createMcpServer(workspace: MapWorkspace): McpServer {
    const server = new McpServer(SERVER_INFO, {instructions: INSTRUCTIONS});
    registerTools(server, workspace);
    return server;
}
