import {applyOps, diffTrees, type MapOp} from '../model/ops';
import type {MindMapTree} from '../model/types';
import type {MindMapStore} from '../store/mindmapStore';
import type {ClientMessage, ServerMessage} from './protocol';

/** The part of the browser `WebSocket` the client uses (lets tests pass a fake). */
export interface SyncSocket {
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: {data: unknown}) => void) | null;
    onclose: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
}

export type SyncStatus = 'connecting' | 'online' | 'offline';

export interface SyncClientOptions {
    /** WebSocket URL of the server, e.g. `ws://localhost:5173/api/sync`. */
    url: string;
    store: MindMapStore;
    clientId?: string;
    createSocket?: (url: string) => SyncSocket;
    /** First reconnect delay; doubles up to `maxReconnectDelayMs`. */
    reconnectDelayMs?: number;
    maxReconnectDelayMs?: number;
    onStatus?: (status: SyncStatus) => void;
}

export interface SyncClient {
    readonly clientId: string;
    status(): SyncStatus;
    /** Version of the last server state the client has seen (0 before the first snapshot). */
    version(): number;
    /** Number of local edit batches the server has not confirmed yet. */
    pendingCount(): number;
    close(): void;
}

const OPEN = 1;

interface Pending {
    seq: number;
    ops: MapOp[];
}

/**
 * Keeps a store in sync with the server.
 *
 * - Local edits apply at once (optimistic). Each store change is diffed into ops and sent as one batch.
 * - The client keeps the last confirmed server tree. On every server change it re-applies its unconfirmed batches
 *   on top of it (rebase), so remote changes never wipe local edits and local edits never block remote ones.
 * - Remote changes skip the undo history (see `applyRemote`).
 * - After a disconnect it reconnects, receives a snapshot, and re-sends the batches the server has not applied.
 */
export function connectSync(opts: SyncClientOptions): SyncClient {
    const {store, url} = opts;
    const clientId = opts.clientId ?? `c-${Math.random().toString(36).slice(2, 10)}`;
    const createSocket = opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SyncSocket);
    const baseDelay = opts.reconnectDelayMs ?? 500;
    const maxDelay = opts.maxReconnectDelayMs ?? 5000;

    let socket: SyncSocket | null = null;
    let status: SyncStatus = 'connecting';
    let closed = false;
    let delay = baseDelay;
    let timer: ReturnType<typeof setTimeout> | null = null;

    let confirmed: MindMapTree | null = null;
    let version = 0;
    let seq = 0;
    let pending: Pending[] = [];
    /** The store tree that the ops sent so far describe. */
    let lastTree = store.getState().tree;
    let applying = false;

    const setStatus = (s: SyncStatus) => {
        if (status === s) return;
        status = s;
        opts.onStatus?.(s);
    };

    const send = (msg: ClientMessage) => {
        if (socket?.readyState === OPEN) socket.send(JSON.stringify(msg));
    };

    const localView = (): MindMapTree =>
        applyOps(
            confirmed!,
            pending.flatMap((p) => p.ops),
        ).tree;

    const show = (tree: MindMapTree, remoteOps: MapOp[] | null) => {
        applying = true;
        try {
            store.getState().applyRemote(tree, remoteOps);
        } finally {
            applying = false;
        }
        lastTree = tree;
    };

    const onSnapshot = (msg: Extract<ServerMessage, {type: 'snapshot'}>) => {
        const previous = confirmed;
        pending = pending.filter((p) => p.seq > msg.lastSeq);
        confirmed = msg.tree;
        version = msg.version;
        const remoteOps = previous && previous.rootId === msg.tree.rootId ? diffTrees(previous, msg.tree) : null;
        show(localView(), remoteOps);
        for (const p of pending) send({type: 'ops', seq: p.seq, ops: p.ops});
        send({type: 'selection', topicId: store.getState().selectedId});
    };

    const onPatch = (msg: Extract<ServerMessage, {type: 'patch'}>) => {
        if (!confirmed || msg.version <= version) return; // duplicate or before the snapshot
        if (msg.version !== version + 1) {
            // A gap: our confirmed state is no longer reliable. Reconnect to get a fresh snapshot.
            socket?.close();
            return;
        }
        confirmed = applyOps(confirmed, msg.ops).tree;
        version = msg.version;
        const own = msg.origin?.clientId === clientId;
        if (own) pending = pending.filter((p) => p.seq !== msg.origin!.seq);
        const view = localView();
        const current = store.getState().tree;
        if (own && diffTrees(current, view).length === 0) return;
        show(view, own ? [] : msg.ops);
    };

    const onMessage = (raw: unknown) => {
        let msg: ServerMessage;
        try {
            msg = JSON.parse(String(raw)) as ServerMessage;
        } catch {
            return;
        }
        switch (msg.type) {
            case 'snapshot':
                onSnapshot(msg);
                break;
            case 'patch':
                onPatch(msg);
                break;
            case 'focus':
                store.getState().select(msg.topicId);
                break;
            case 'error':
                console.warn('[sync] server error:', msg.message);
                break;
        }
    };

    const unsubscribe = store.subscribe((s, prev) => {
        if (applying) return;
        if (s.tree !== lastTree && confirmed) {
            if (s.tree.rootId !== confirmed.rootId) {
                // A different map was loaded locally; the server copy wins.
                show(localView(), null);
                return;
            }
            const ops = diffTrees(lastTree, s.tree);
            lastTree = s.tree;
            if (ops.length) {
                seq += 1;
                pending.push({seq, ops});
                send({type: 'ops', seq, ops});
            }
        }
        if (s.selectedId !== prev.selectedId) send({type: 'selection', topicId: s.selectedId});
    });

    const connect = () => {
        if (closed) return;
        setStatus('connecting');
        const ws = createSocket(url);
        socket = ws;
        ws.onopen = () => {
            delay = baseDelay;
            setStatus('online');
            send({type: 'hello', clientId});
        };
        ws.onmessage = (ev) => onMessage(ev.data);
        ws.onerror = () => {};
        ws.onclose = () => {
            if (socket !== ws) return;
            socket = null;
            setStatus('offline');
            if (closed) return;
            timer = setTimeout(connect, delay);
            delay = Math.min(delay * 2, maxDelay);
        };
    };
    connect();

    return {
        clientId,
        status: () => status,
        version: () => version,
        pendingCount: () => pending.length,
        close: () => {
            closed = true;
            if (timer) clearTimeout(timer);
            unsubscribe();
            socket?.close();
            socket = null;
            setStatus('offline');
        },
    };
}
