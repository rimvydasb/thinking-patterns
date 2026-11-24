import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {FastifyInstance} from 'fastify';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {toOutline} from '../../../app/mindmap/model/tree';
import {createMindMapStore, type MindMapStore} from '../../../app/mindmap/store/mindmapStore';
import {SYNC_PATH, type ServerMessage} from '../../../app/mindmap/sync/protocol';
import {connectSync, type SyncClient, type SyncSocket} from '../../../app/mindmap/sync/syncClient';
import {buildServer} from '../../app';
import {createMapWorkspace, type MapWorkspace} from '../../map/mapWorkspace';

const mapText = (...lines: string[]) => ['---', 'mindmap: 1', '---', '', '# Map', '', ...lines, ''].join('\n');

let app: FastifyInstance;
let workspace: MapWorkspace;
let base: string;
/** The maps directory (a real temp directory) and the map file open at the start of each test. */
let dir: string;
let mapFile: string;
const cleanups: (() => unknown)[] = [];
/** The working copy of the open map file. */
const doc = () => workspace.current()!.doc;

beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), 'sync-test-')));
    mapFile = path.join(dir, 'plan.map.md');
    await writeFile(mapFile, mapText('- Central Topic'));
    workspace = createMapWorkspace(dir, {pollMs: 50});
    await workspace.open(mapFile);
    ({app} = await buildServer({workspace}));
    await app.listen({port: 0, host: '127.0.0.1'});
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    base = `127.0.0.1:${addr.port}`;
});

afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
    await app.close();
    await workspace.close();
    await rm(dir, {recursive: true, force: true});
});

/** Waits until `check` stops throwing. */
async function until(check: () => unknown, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        try {
            await check();
            return;
        } catch (e) {
            if (Date.now() > end) throw e;
            await new Promise((r) => setTimeout(r, 10));
        }
    }
}

/** A browser-like app: store + sync client over a real WebSocket. */
function openApp(): {store: MindMapStore; sync: SyncClient; sockets: WebSocket[]} {
    const store = createMindMapStore();
    const sockets: WebSocket[] = [];
    const sync = connectSync({
        url: `ws://${base}${SYNC_PATH}`,
        store,
        reconnectDelayMs: 20,
        createSocket: (url) => {
            const ws = new WebSocket(url);
            sockets.push(ws);
            return ws as unknown as SyncSocket;
        },
    });
    cleanups.push(() => sync.close());
    return {store, sync, sockets};
}

async function mcp() {
    const client = new Client({name: 'agent', version: '1.0.0'});
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://${base}/mcp`)));
    cleanups.push(() => client.close());
    // oxlint-disable-next-line no-explicit-any
    return async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
        const res = await client.callTool({name, arguments: args});
        const text = (res.content as {text: string}[])[0].text;
        if (res.isError) throw new Error(text);
        return JSON.parse(text);
    };
}

const serverOutline = () => toOutline(doc().tree);
/** Id of the topic with this text in a store (test helper; agents never see ids). */
const idOf = (store: MindMapStore, text: string) =>
    Object.values(store.getState().tree.nodes).find((n) => n.text === text)!.id;

describe('live sync', () => {
    it('pushes agent changes made over MCP to the open app', async () => {
        const {store, sync} = openApp();
        await until(() => expect(sync.version()).toBe(1));
        const call = await mcp();

        await call('add_topics', {markdown: '- Ideas\n  - Faster builds'});
        await until(() => expect(toOutline(store.getState().tree)).toEqual(serverOutline()));
        expect(serverOutline().children![0].text).toBe('Ideas');

        await call('update_topic', {topicName: 'Ideas', text: 'Big ideas'});
        await until(() => expect(store.getState().tree.nodes[idOf(store, 'Big ideas')]).toBeDefined());

        await call('focus_topic', {topicName: 'Faster builds'});
        await until(() => expect(store.getState().selectedId).toBe(idOf(store, 'Faster builds')));
        // Agent changes are not in the user's undo history.
        expect(store.getState().past).toEqual([]);
    });

    it('sends user edits to the server, where agents read them', async () => {
        const {store, sync} = openApp();
        await until(() => expect(sync.version()).toBe(1));
        store.getState().addChild();
        store.getState().commitEdit('Typed by user');
        await until(() => expect(sync.pendingCount()).toBe(0));

        const call = await mcp();
        expect((await call('get_topic', {topicName: 'Typed by user'})).path).toEqual([
            'Central Topic',
            'Typed by user',
        ]);
        await until(() => expect(doc().selection).not.toBeNull());
        const sel = await call('get_selection');
        expect(sel.selection.path).toEqual(['Central Topic', 'Typed by user']);
    });

    it('keeps two apps and an agent consistent under concurrent edits', async () => {
        const a = openApp();
        const b = openApp();
        await until(() => expect([a.sync.version(), b.sync.version()]).toEqual([1, 1]));
        const call = await mcp();
        await call('add_topics', {markdown: '- X\n- Y\n- Z'});
        await until(() => expect(Object.keys(a.store.getState().tree.nodes)).toHaveLength(4));
        await until(() => expect(Object.keys(b.store.getState().tree.nodes)).toHaveLength(4));

        // Interleave edits without waiting: local edits are optimistic, agent edits race them.
        a.store.getState().select(idOf(a.store, 'X'));
        a.store.getState().addChild();
        a.store.getState().commitEdit('child of X from A');
        b.store.getState().select(idOf(b.store, 'Y'));
        b.store.getState().deleteSelected();
        const agentEdit = call('add_topics', {parentName: 'X', topics: [{text: 'from agent'}]});
        b.store.getState().select(idOf(b.store, 'Z'));
        b.store.getState().startEditing();
        b.store.getState().commitEdit('Z renamed by B');
        // Add and edit are two undo steps; both revert A's own child only, not the agent's or B's edits.
        a.store.getState().undo();
        a.store.getState().undo();
        await agentEdit;

        await until(() => {
            expect(a.sync.pendingCount() + b.sync.pendingCount()).toBe(0);
            expect(toOutline(a.store.getState().tree)).toEqual(serverOutline());
            expect(toOutline(b.store.getState().tree)).toEqual(serverOutline());
        });
        expect(serverOutline()).toEqual({
            text: 'Central Topic',
            children: [{text: 'X', children: [{text: 'from agent'}]}, {text: 'Z renamed by B'}],
        });
    });

    it('re-sends unconfirmed edits after a reconnect and catches up on missed changes', async () => {
        const {store, sync, sockets} = openApp();
        await until(() => expect(sync.status()).toBe('online'));
        await until(() => expect(sync.version()).toBe(1));
        const call = await mcp();

        sockets[0].terminate(); // connection drops
        await until(() => expect(sync.status()).not.toBe('online'));
        store.getState().addChild(); // offline edit
        store.getState().commitEdit('offline edit');
        await call('add_topics', {topics: [{text: 'agent while offline'}]});

        await until(() => {
            expect(sync.pendingCount()).toBe(0);
            expect(toOutline(store.getState().tree)).toEqual(serverOutline());
        });
        const texts = serverOutline()
            .children!.map((c) => c.text)
            .sort();
        expect(texts).toEqual(['agent while offline', 'offline edit']);
    });
});

/** A raw WebSocket client that records the server messages. */
async function rawClient(clientId = 'raw') {
    const ws = new WebSocket(`ws://${base}${SYNC_PATH}`);
    const messages: ServerMessage[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(String(data))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({type: 'hello', clientId}));
    cleanups.push(() => ws.close());
    return {ws, messages, send: (msg: unknown) => ws.send(JSON.stringify(msg))};
}

const post = (url: string, body: unknown) =>
    fetch(`http://${base}${url}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
    });

describe('the map file', () => {
    it('sends the file state in the snapshot', async () => {
        const {messages} = await rawClient();
        await until(() => expect(messages[0]).toMatchObject({type: 'snapshot', file: {path: mapFile, state: 'clean'}}));
    });

    it('writes the file before an MCP change tool returns', async () => {
        const call = await mcp();
        await call('add_topics', {markdown: '- From agent'});
        expect(await readFile(mapFile, 'utf8')).toBe(mapText('- Central Topic', '  - From agent'));
    });

    it('writes GUI edits to the file', async () => {
        const {store, sync} = openApp();
        await until(() => expect(sync.version()).toBe(1));
        store.getState().addChild();
        store.getState().commitEdit('Typed by user');
        await until(async () => expect(await readFile(mapFile, 'utf8')).toContain('  - Typed by user\n'));
        await until(() => expect(workspace.current()!.fileState().state).toBe('clean'));
        expect(await readFile(mapFile, 'utf8')).toBe(mapText('- Central Topic', '  - Typed by user'));
    });

    it('sends a change of the file on disk to a connected client as a patch', async () => {
        const {store, sync} = openApp();
        const raw = await rawClient();
        await until(() => expect(sync.version()).toBe(1));
        await writeFile(mapFile, mapText('- Central Topic', '  - Edited in editor'));
        await until(() => expect(serverOutline().children).toEqual([{text: 'Edited in editor'}]));
        await until(() => expect(toOutline(store.getState().tree)).toEqual(serverOutline()));
        const patch = raw.messages.find((m) => m.type === 'patch');
        expect(patch).toMatchObject({type: 'patch', version: 2});
        expect(patch && 'origin' in patch).toBe(false);
        // The file change is not in the user's undo history.
        expect(store.getState().past).toEqual([]);
    });

    it('sends file state changes, and writes the app version on writeFile', async () => {
        const raw = await rawClient();
        await until(() => expect(raw.messages).toHaveLength(1));
        await writeFile(mapFile, 'not a map\n');
        await until(() => expect(raw.messages.at(-1)).toMatchObject({type: 'file', file: {state: 'invalid'}}));
        raw.send({type: 'writeFile'});
        await until(() => expect(raw.messages.at(-1)).toMatchObject({type: 'file', file: {state: 'clean'}}));
        expect(await readFile(mapFile, 'utf8')).toBe(mapText('- Central Topic'));
    });

    it('sends file null while no file is open, and refuses ops', async () => {
        await workspace.close();
        const raw = await rawClient();
        await until(() => expect(raw.messages).toEqual([{type: 'file', file: null}]));
        raw.send({type: 'ops', seq: 1, ops: []});
        await until(() => expect(raw.messages.at(-1)).toEqual({type: 'error', message: 'No map file is open.'}));
        expect((await fetch(`http://${base}/api/map`)).status).toBe(404);
    });

    it('sends every client a snapshot of the new map with a new rootId after an open', async () => {
        const other = path.join(dir, 'other.map.md');
        await writeFile(other, mapText('- Other map', '  - Topic'));
        const {store, sync} = openApp();
        const raw = await rawClient();
        await until(() => expect(sync.version()).toBe(1));
        const oldRoot = doc().tree.rootId;

        const res = await post('/api/map/open', {path: other});
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({path: other, state: 'clean'});
        await until(() => expect(raw.messages.filter((m) => m.type === 'snapshot')).toHaveLength(2));
        const snap = raw.messages.filter((m) => m.type === 'snapshot')[1];
        expect(snap).toMatchObject({type: 'snapshot', file: {path: other}, version: 1});
        expect(snap.type === 'snapshot' && snap.tree.rootId).not.toBe(oldRoot);
        await until(() =>
            expect(toOutline(store.getState().tree)).toEqual({text: 'Other map', children: [{text: 'Topic'}]}),
        );
    });

    it('creates a new map file, and refuses an existing one', async () => {
        const created = path.join(dir, 'new.map.md');
        const res = await post('/api/map/open', {path: created, create: true});
        expect(res.status).toBe(200);
        expect(await readFile(created, 'utf8')).toBe(mapText('- Central Topic'));
        expect((await post('/api/map/open', {path: created, create: true})).status).toBe(409);
        expect((await post('/api/map/open', {path: path.join(dir, 'none.map.md')})).status).toBe(404);
    });

    it('rejects paths outside the maps directory, including .. and a symlink that points outside', async () => {
        const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'outside-')));
        cleanups.push(() => rm(outside, {recursive: true, force: true}));
        await writeFile(path.join(outside, 'secret.map.md'), mapText('- Secret'));
        await symlink(path.join(outside, 'secret.map.md'), path.join(dir, 'link.map.md'));
        await symlink(outside, path.join(dir, 'linkdir'));

        for (const p of [
            path.join(outside, 'secret.map.md'),
            `${dir}/../${path.basename(outside)}/secret.map.md`,
            path.join(dir, 'link.map.md'),
            'relative.map.md',
            path.join(dir, 'notes.md'),
        ]) {
            expect([p, (await post('/api/map/open', {path: p})).status]).toEqual([p, 400]);
        }
        expect((await post('/api/map/open', {path: path.join(dir, 'linkdir', 'x.map.md'), create: true})).status).toBe(
            400,
        );
        expect((await fetch(`http://${base}/api/files?dir=${encodeURIComponent(outside)}`)).status).toBe(400);
        expect(
            (await fetch(`http://${base}/api/files?dir=${encodeURIComponent(path.join(dir, 'linkdir'))}`)).status,
        ).toBe(400);
        expect(workspace.current()!.fileState().path).toBe(mapFile);
    });

    it('lists subdirectories and *.map.md files only, and hides .git and node_modules', async () => {
        for (const d of ['.git', 'node_modules', 'docs', 'archive']) await mkdir(path.join(dir, d));
        await writeFile(path.join(dir, 'README.md'), '# Readme');
        await writeFile(path.join(dir, 'b.map.md'), mapText('- B'));
        await writeFile(path.join(dir, 'docs', 'inner.map.md'), mapText('- Inner'));

        const listing = await (await fetch(`http://${base}/api/files`)).json();
        expect(listing).toEqual({
            root: dir,
            dir,
            parent: null,
            entries: [
                {name: 'archive', path: path.join(dir, 'archive'), kind: 'dir'},
                {name: 'docs', path: path.join(dir, 'docs'), kind: 'dir'},
                {name: 'b.map.md', path: path.join(dir, 'b.map.md'), kind: 'file'},
                {name: 'plan.map.md', path: mapFile, kind: 'file'},
            ],
        });
        const docs = await (
            await fetch(`http://${base}/api/files?dir=${encodeURIComponent(path.join(dir, 'docs'))}`)
        ).json();
        expect(docs).toMatchObject({dir: path.join(dir, 'docs'), parent: dir, entries: [{name: 'inner.map.md'}]});
    });
});
