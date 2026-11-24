import type {FastifyInstance} from 'fastify';
import type {WebSocket} from 'ws';
import {SYNC_PATH, type ServerMessage} from '../../app/mindmap/sync/protocol';
import {MapError, type MapDocument} from '../map/mapDocument';
import {clientMessageSchema} from '../map/schemas';

/**
 * WebSocket endpoint that keeps apps in sync with the map (protocol: app/mindmap/sync/protocol.ts).
 * Requires `@fastify/websocket` to be registered.
 */
export async function syncRoutes(app: FastifyInstance, opts: {doc: MapDocument}) {
    const {doc} = opts;

    app.get(SYNC_PATH, {websocket: true}, (socket: WebSocket) => {
        let clientId: string | null = null;
        let unsubscribe: (() => void) | null = null;

        const send = (msg: ServerMessage) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        };

        socket.on('message', (data) => {
            let parsed;
            try {
                parsed = clientMessageSchema.safeParse(JSON.parse(String(data)));
            } catch {
                return send({type: 'error', message: 'Message is not JSON.'});
            }
            if (!parsed.success) return send({type: 'error', message: `Invalid message: ${parsed.error.message}`});
            const msg = parsed.data;

            if (msg.type === 'hello') {
                unsubscribe?.();
                clientId = msg.clientId;
                // Snapshot and subscription in the same tick: no patch can fall between them.
                send({type: 'snapshot', version: doc.version, tree: doc.tree, lastSeq: doc.lastSeq.get(clientId) ?? 0});
                unsubscribe = doc.subscribe(send);
                return;
            }
            if (!clientId) return send({type: 'error', message: 'Send "hello" first.'});
            if (msg.type === 'ops') {
                try {
                    doc.apply(msg.ops, {origin: {clientId, seq: msg.seq}});
                } catch (err) {
                    send({type: 'error', message: err instanceof MapError ? err.message : 'Could not apply ops.'});
                }
            } else {
                doc.setSelection(clientId, msg.topicId);
            }
        });

        socket.on('close', () => unsubscribe?.());
    });
}
