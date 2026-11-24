/**
 * WebSocket protocol between the app and the server (`/api/sync`). Messages are JSON objects.
 * The server holds one map: the one the user has open. See docs/mcp-server-spec.md, "Sync protocol".
 * A Tauri/Rust back end MUST implement the same messages.
 */
import type {MapOp} from '../model/ops';
import type {MindMapTree, NodeId} from '../model/types';

export const SYNC_PATH = '/api/sync';

/** Identifies a batch of ops sent by one client. `seq` grows by 1 per batch and survives reconnects. */
export interface OpOrigin {
    clientId: string;
    seq: number;
}

export type ClientMessage =
    /** First message after connect. The server answers with `snapshot`. */
    | {type: 'hello'; clientId: string}
    /** A batch of local edits. The server applies it atomically and broadcasts a `patch`. */
    | {type: 'ops'; seq: number; ops: MapOp[]}
    /** The topic the user has selected (for the `get_selection` tool). */
    | {type: 'selection'; topicId: NodeId};

export type ServerMessage =
    /**
     * Full state of the map. `lastSeq` is the highest batch `seq` from this client that the server has applied:
     * the client drops pending batches up to it and re-sends the rest.
     */
    | {type: 'snapshot'; version: number; tree: MindMapTree; lastSeq: number}
    /**
     * A change of the map. `version` is the map version after the change; versions have no gaps per connection.
     * `ops` holds only the ops that took effect. `origin` is set when a sync client sent the batch (also echoed back
     * to the sender as its acknowledgement); it is absent for changes made by agents.
     */
    | {type: 'patch'; version: number; ops: MapOp[]; origin?: OpOrigin}
    /** An agent asks the app to select and show a topic (`focus_topic` tool). */
    | {type: 'focus'; topicId: NodeId}
    | {type: 'error'; message: string};
