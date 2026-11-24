import {applyOps, type MapOp} from '../../app/mindmap/model/ops';
import {createTree} from '../../app/mindmap/model/tree';
import type {MindMapTree, NodeId} from '../../app/mindmap/model/types';
import type {OpOrigin} from '../../app/mindmap/sync/protocol';

export interface Selection {
    topicId: NodeId;
    clientId: string;
    at: string;
}

export type MapEvent =
    {type: 'patch'; version: number; ops: MapOp[]; origin?: OpOrigin} | {type: 'focus'; topicId: NodeId};

/** An error the agent or the app can act on. Its message is shown to the agent as is. */
export class MapError extends Error {}

export interface ApplyOptions {
    /** Set for batches from sync clients. */
    origin?: OpOrigin;
}

export interface ApplyOutcome {
    version: number;
    applied: MapOp[];
}

/**
 * The one map the user has open. It lives in memory and is the single source of truth while the server runs;
 * persistence comes later.
 */
export class MapDocument {
    tree: MindMapTree;
    /** Grows by 1 per change. */
    version = 1;
    /** Highest batch `seq` applied per sync client (deduplicates re-sent batches). */
    readonly lastSeq = new Map<string, number>();
    selection: Selection | null = null;
    private readonly listeners = new Set<(e: MapEvent) => void>();

    constructor(tree: MindMapTree = createTree('Central Topic')) {
        this.tree = tree;
    }

    subscribe(listener: (e: MapEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(e: MapEvent) {
        for (const l of this.listeners) l(e);
    }

    /**
     * Applies a batch of ops atomically (one version step) and broadcasts it as one `patch`.
     * A batch from a sync client is always broadcast, even with no effect, because the echo is its acknowledgement.
     * A batch without effect from an agent changes nothing and is not broadcast.
     * A re-sent client batch (`seq` not above the last applied one) is ignored.
     */
    apply(ops: readonly MapOp[], opts: ApplyOptions = {}): ApplyOutcome {
        const {origin} = opts;
        if (origin && origin.seq <= (this.lastSeq.get(origin.clientId) ?? 0)) {
            return {version: this.version, applied: []};
        }
        const result = applyOps(this.tree, ops);
        if (origin) this.lastSeq.set(origin.clientId, origin.seq);
        if (!result.applied.length && !origin) return {version: this.version, applied: []};

        this.tree = result.tree;
        this.version += 1;
        if (this.selection && !this.tree.nodes[this.selection.topicId]) this.selection = null;
        this.emit({type: 'patch', version: this.version, ops: result.applied, ...(origin ? {origin} : {})});
        return {version: this.version, applied: result.applied};
    }

    setSelection(clientId: string, topicId: NodeId) {
        if (this.tree.nodes[topicId]) this.selection = {topicId, clientId, at: new Date().toISOString()};
    }

    /** Asks the open apps to select and show the topic. */
    focus(topicId: NodeId) {
        this.emit({type: 'focus', topicId});
    }
}
