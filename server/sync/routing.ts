import type {FastifyInstance} from 'fastify';
import type {WebSocket} from 'ws';
import {SYNC_PATH, type ServerMessage} from '../../app/mindmap/sync/protocol';
import {MapError} from '../map/mapDocument';
import type {MapFileBinding} from '../map/mapFileBinding';
import type {MapWorkspace} from '../map/mapWorkspace';
import {clientMessageSchema} from '../map/schemas';

const NO_FILE = 'No map file is open.';

/**
 * WebSocket endpoint that keeps apps in sync with the open map (protocol: app/mindmap/sync/protocol.ts).
 * Requires `@fastify/websocket` to be registered.
 *
 * After `hello`, a client gets a `snapshot` of the open map, or `file: null` while no map file is open. When another
 * file opens, every client gets a `snapshot` of the new map.
 */
export async function syncRoutes(app: FastifyInstance, opts: {workspace: MapWorkspace}) {
    const {workspace} = opts;

    app.get(SYNC_PATH, {websocket: true}, (socket: WebSocket) => {
        let clientId: string | null = null;
        let detach: () => void = () => {};

        const send = (msg: ServerMessage) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        };

        /** Sends the state of `binding` and follows its changes. */
        const attach = (binding: MapFileBinding | null) => {
            detach();
            detach = () => {};
            if (!binding || !clientId) {
                send({type: 'file', file: null});
                return;
            }
            const {doc} = binding;
            // Snapshot and subscriptions in the same tick: no patch can fall between them.
            send({
                type: 'snapshot',
                version: doc.version,
                tree: doc.tree,
                lastSeq: doc.lastSeq.get(clientId) ?? 0,
                file: binding.fileState(),
            });
            const offDoc = doc.subscribe(send);
            const offFile = binding.subscribe((file) => send({type: 'file', file}));
            detach = () => {
                offDoc();
                offFile();
            };
        };

        const offWorkspace = workspace.subscribe((binding) => {
            if (clientId) attach(binding);
        });

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
                clientId = msg.clientId;
                attach(workspace.current());
                return;
            }
            if (!clientId) return send({type: 'error', message: 'Send "hello" first.'});
            const binding = workspace.current();
            if (msg.type === 'selection') {
                binding?.doc.setSelection(clientId, msg.topicId);
                return;
            }
            if (!binding) return send({type: 'error', message: NO_FILE});
            if (msg.type === 'writeFile') {
                binding.forceWrite().catch((err: unknown) => {
                    send({type: 'error', message: err instanceof Error ? err.message : 'Could not write the file.'});
                });
                return;
            }
            try {
                binding.doc.apply(msg.ops, {origin: {clientId, seq: msg.seq}});
            } catch (err) {
                send({type: 'error', message: err instanceof MapError ? err.message : 'Could not apply ops.'});
            }
        });

        socket.on('close', () => {
            detach();
            offWorkspace();
        });
    });
}
