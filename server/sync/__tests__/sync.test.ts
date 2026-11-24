import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {FastifyInstance} from 'fastify';
import {WebSocket} from 'ws';
import {toOutline} from '../../../app/mindmap/model/tree';
import {createMindMapStore, type MindMapStore} from '../../../app/mindmap/store/mindmapStore';
import {SYNC_PATH} from '../../../app/mindmap/sync/protocol';
import {connectSync, type SyncClient, type SyncSocket} from '../../../app/mindmap/sync/syncClient';
import {buildServer} from '../../app';
import type {MapDocument} from '../../map/mapDocument';

let app: FastifyInstance;
let doc: MapDocument;
let base: string;
const cleanups: (() => unknown)[] = [];

beforeEach(async () => {
    ({app, doc} = await buildServer());
    await app.listen({port: 0, host: '127.0.0.1'});
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    base = `127.0.0.1:${addr.port}`;
});

afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
    await app.close();
});

/** Waits until `check` stops throwing. */
async function until(check: () => void, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        try {
            check();
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

const serverOutline = () => toOutline(doc.tree);
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
        await until(() => expect(doc.selection).not.toBeNull());
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
