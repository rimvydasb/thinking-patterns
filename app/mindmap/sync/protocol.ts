/**
 * WebSocket protocol between the app and the server (`/api/sync`). Messages are JSON objects.
 * The server holds one map: the map file the user has open (or none). See docs/mcp-server-spec.md, "Sync protocol".
 * A Tauri/Rust back end MUST implement the same messages.
 */
import type {Diagnostic} from '../model/mapFile/types';
import type {MapOp} from '../model/ops';
import type {MindMapTree, NodeId} from '../model/types';

export const SYNC_PATH = '/api/sync';

/**
 * - `clean`: the file holds the map.
 * - `writing`: changes are being written.
 * - `invalid`: the file does not parse. Writes pause; edits stay in memory.
 * - `missing`: the file was deleted or renamed. Writes pause; edits stay in memory.
 */
export type FileStateKind = 'clean' | 'writing' | 'invalid' | 'missing';

/** State of the open map file (docs/map-file-lifecycle-story.md, "File state lifecycle"). */
export interface FileState {
    /** Absolute path of the map file. */
    path: string;
    state: FileStateKind;
    /** Errors and warnings of the last parse. */
    diagnostics: Diagnostic[];
    /** ISO time of the last write by the server. */
    writtenAt: string | null;
    /** ISO time of the last change made outside the app that the server read. */
    changedOnDiskAt: string | null;
}

/** `GET /api/files`: a directory under the maps root. */
export interface DirListing {
    /** Absolute path of the maps root (`MAPS_DIR`). */
    root: string;
    /** Absolute path of the listed directory. */
    dir: string;
    /** Absolute path of the parent directory, `null` at the root. */
    parent: string | null;
    /** Subdirectories first, then `*.map.md` files, each sorted by name. */
    entries: {name: string; path: string; kind: 'dir' | 'file'}[];
}

/** REST endpoints for the map file. */
export const FILES_PATH = '/api/files';
export const OPEN_MAP_PATH = '/api/map/open';

/** Body of `POST /api/map/open`. `create: true` creates a new map file and fails if it exists. */
export interface OpenMapRequest {
    path: string;
    create?: boolean;
}

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
    | {type: 'selection'; topicId: NodeId}
    /** Writes the map in memory to the file, in any file state ("Write the app version to the file"). */
    | {type: 'writeFile'};

export type ServerMessage =
    /**
     * Full state of the map. `lastSeq` is the highest batch `seq` from this client that the server has applied:
     * the client drops pending batches up to it and re-sends the rest. Sent after `hello`, and to all clients when
     * another file opens (the new map has a new `rootId`).
     */
    | {type: 'snapshot'; version: number; tree: MindMapTree; lastSeq: number; file: FileState}
    /** The file state changed. `null`: no map file is open (sent after `hello` instead of a snapshot). */
    | {type: 'file'; file: FileState | null}
    /**
     * A change of the map. `version` is the map version after the change; versions have no gaps per connection.
     * `ops` holds only the ops that took effect. `origin` is set when a sync client sent the batch (also echoed back
     * to the sender as its acknowledgement); it is absent for changes made by agents.
     */
    | {type: 'patch'; version: number; ops: MapOp[]; origin?: OpOrigin}
    /** An agent asks the app to select and show a topic (`focus_topic` tool). */
    | {type: 'focus'; topicId: NodeId}
    | {type: 'error'; message: string};
