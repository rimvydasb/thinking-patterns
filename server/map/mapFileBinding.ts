import {createHash} from 'node:crypto';
import path from 'node:path';
import {isMindMapFile, NOT_A_MIND_MAP, parseMapFile} from '../../app/mindmap/model/mapFile/parse';
import {reconcileTrees} from '../../app/mindmap/model/mapFile/reconcile';
import {newMapFileModel, serializeMapFile} from '../../app/mindmap/model/mapFile/serialize';
import type {Diagnostic, MapFileModel} from '../../app/mindmap/model/mapFile/types';
import {diffTrees, type MapOp} from '../../app/mindmap/model/ops';
import {createTree, newId} from '../../app/mindmap/model/tree';
import type {MindMapTree} from '../../app/mindmap/model/types';
import type {FileState, FileStateKind} from '../../app/mindmap/sync/protocol';
import {NodeFsPort, type FsPort} from './fsPort';
import {MapDocument, MapError} from './mapDocument';

/** The file as last read or written by the binding. */
export interface FileStamp {
    mtimeMs: number;
    size: number;
    /** sha256 hex of the content. */
    hash: string;
}

/**
 * Connects one `.map.md` file to one `MapDocument` (docs/map-file-lifecycle-story.md, D1). The file is the durable
 * truth and the document is the working copy:
 * - Every content change of the document is written to the file (write-through, coalesced, atomic replace).
 * - Changes of the file by other programs are read, matched to the current topics, and applied to the document as
 *   one batch of ops, so open apps receive them as a normal `patch`.
 */
export interface MapFileBinding {
    readonly doc: MapDocument;
    /** Current state for snapshots and `get_map_info`. */
    fileState(): FileState;
    /** File state changes (for the sync routes). Returns unsubscribe. */
    subscribe(listener: (state: FileState) => void): () => void;
    /** Resolves when all changes so far are written. Rejects in the `invalid` and `missing` states. */
    flush(): Promise<void>;
    /** Writes the map in memory to the file in any state (the GUI "Write the app version to the file" action). */
    forceWrite(): Promise<void>;
    /** Flushes, then stops the watch and the poll. In `invalid` and `missing`, unwritten changes are dropped. */
    close(): Promise<void>;
}

export type MapFileErrorCode = 'not-found' | 'exists' | 'not-mindmap';

/** Opening a map file failed. */
export class MapFileError extends MapError {
    constructor(
        message: string,
        readonly code: MapFileErrorCode,
    ) {
        super(message);
    }
}

export interface OpenMapFileOptions {
    fs?: FsPort;
    /** Interval of the stat poll that catches missed watch events. Default 1000. 0 turns the poll off. */
    pollMs?: number;
    /** Creates a new format v1 file with the central topic. Rejects if the file exists. */
    create?: boolean;
}

/**
 * Opens a map file. Rejects with `MapFileError` if it does not exist (or exists, with `create`), or if it is a
 * Markdown file without the `mindmap: 1` frontmatter flag (`not-mindmap`). A file with the flag but a broken map
 * (for example no `# Map` section) opens in the `invalid` state with its parse errors.
 */
export async function openMapFile(filePath: string, opts: OpenMapFileOptions = {}): Promise<MapFileBinding> {
    const fs = opts.fs ?? new NodeFsPort();
    if (opts.create) {
        if (await fs.stat(filePath)) throw new MapFileError(`The file already exists: ${filePath}`, 'exists');
        await fs.writeAtomic(filePath, serializeMapFile(newMapFileModel()));
    }
    const stat = await fs.stat(filePath);
    if (!stat) throw new MapFileError(`The file does not exist: ${filePath}`, 'not-found');
    const text = await fs.read(filePath);
    if (!isMindMapFile(text)) throw new MapFileError(`${NOT_A_MIND_MAP} ${filePath}`, 'not-mindmap');
    const binding = new FileBinding(filePath, fs, text, stat);
    binding.start(opts.pollMs ?? 1000);
    return binding;
}

/** The message that MCP change tools return while writes are paused. */
export function writesPausedMessage(state: FileState): string {
    if (state.state === 'missing') {
        return (
            `The map file does not exist any more: ${state.path}. Changes are paused. ` +
            'Restore the file, or ask the user to write the app version to the file.'
        );
    }
    const problems = state.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `- line ${d.line}: ${d.message}`)
        .join('\n');
    return `The map file has errors, so changes are paused. Fix the file ${state.path}:\n${problems}`;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const now = () => new Date().toISOString();

/** True if the trees differ in more than the folded state (which the file does not hold, D4). */
function contentDiffers(from: MindMapTree, to: MindMapTree): boolean {
    return diffTrees(from, to).some((op) => op.op !== 'setCollapsed');
}

type Trigger = 'watch' | 'poll' | 'write';

class FileBinding implements MapFileBinding {
    readonly doc: MapDocument;
    private state: FileStateKind;
    private diagnostics: Diagnostic[];
    private writtenAt: string | null = null;
    private changedOnDiskAt: string | null = null;
    private known: FileStamp;
    /** The tree as last read from or written to the file. */
    private syncedTree: MindMapTree;
    /** Frontmatter, extra sections and orphan notes of the last valid parse; written back unchanged. */
    private meta: Omit<MapFileModel, 'tree'>;

    private readonly listeners = new Set<(s: FileState) => void>();
    /** Runs one `checkDisk()` or write at a time. */
    private chain: Promise<void> = Promise.resolve();
    private writeQueued = false;
    private checkQueued = false;
    private ingesting = false;
    private closed = false;
    private stopWatch: () => void = () => {};
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private readonly unsubscribeDoc: () => void;

    constructor(
        private readonly path: string,
        private readonly fs: FsPort,
        text: string,
        stat: {mtimeMs: number; size: number},
    ) {
        this.known = {...stat, hash: sha256(text)};
        const parsed = parseMapFile(text);
        const {tree: _tree, ...meta} = newMapFileModel();
        if (parsed.ok) {
            const {tree, ...fileMeta} = parsed.model;
            this.doc = new MapDocument(tree);
            this.meta = fileMeta;
            this.state = 'clean';
        } else {
            this.doc = new MapDocument(createTree('Central Topic', newId()));
            this.meta = meta;
            this.state = 'invalid';
        }
        this.diagnostics = parsed.diagnostics;
        this.syncedTree = this.doc.tree;
        this.unsubscribeDoc = this.doc.subscribe((e) => {
            if (e.type !== 'patch' || this.ingesting || this.closed) return;
            if (e.ops.every((op: MapOp) => op.op === 'setCollapsed')) return; // D4
            this.requestWrite();
        });
    }

    start(pollMs: number) {
        const name = path.basename(this.path);
        this.stopWatch = this.fs.watchDir(path.dirname(this.path), (changed) => {
            if (!changed || changed === name) this.requestCheck('watch');
        });
        if (pollMs > 0) {
            this.pollTimer = setInterval(() => this.requestCheck('poll'), pollMs);
            this.pollTimer.unref?.();
        }
    }

    fileState(): FileState {
        return {
            path: this.path,
            state: this.state,
            diagnostics: this.diagnostics,
            writtenAt: this.writtenAt,
            changedOnDiskAt: this.changedOnDiskAt,
        };
    }

    subscribe(listener: (s: FileState) => void) {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    }

    flush() {
        return this.enqueue(async () => {
            if (this.paused()) throw new MapError(writesPausedMessage(this.fileState()));
        });
    }

    forceWrite() {
        return this.enqueue(async () => {
            this.writeQueued = false;
            await this.write();
        });
    }

    async close() {
        this.stopWatch();
        if (this.pollTimer) clearInterval(this.pollTimer);
        try {
            await this.flush();
        } catch {
            // invalid or missing: the unwritten changes are dropped (the picker asks the user first)
        }
        this.closed = true;
        this.unsubscribeDoc();
        this.listeners.clear();
    }

    // ---- internals --------------------------------------------------------------------------------------------

    private paused() {
        return this.state === 'invalid' || this.state === 'missing';
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.chain.then(task);
        this.chain = run.catch(() => {});
        return run;
    }

    private update(patch: Partial<Pick<FileState, 'state' | 'diagnostics' | 'writtenAt' | 'changedOnDiskAt'>>) {
        const before = JSON.stringify(this.fileState());
        if (patch.state !== undefined) this.state = patch.state;
        if (patch.diagnostics !== undefined) this.diagnostics = patch.diagnostics;
        if (patch.writtenAt !== undefined) this.writtenAt = patch.writtenAt;
        if (patch.changedOnDiskAt !== undefined) this.changedOnDiskAt = patch.changedOnDiskAt;
        const state = this.fileState();
        if (JSON.stringify(state) !== before) for (const l of this.listeners) l(state);
    }

    private requestWrite() {
        if (this.paused() || this.closed) return;
        if (!this.writeQueued) {
            this.writeQueued = true;
            void this.enqueue(async () => {
                this.writeQueued = false;
                await this.checkDisk('write');
                if (!this.paused()) await this.write();
            });
        }
        this.update({state: 'writing'});
    }

    private requestCheck(trigger: Trigger) {
        if (this.checkQueued || this.closed) return;
        this.checkQueued = true;
        void this.enqueue(async () => {
            this.checkQueued = false;
            await this.checkDisk(trigger);
        });
    }

    /** Detects a change of the file by stamp, confirmed by hash (D5), and ingests it. */
    private async checkDisk(trigger: Trigger) {
        const stat = await this.fs.stat(this.path);
        if (!stat) {
            if (this.state !== 'missing') this.update({state: 'missing', diagnostics: []});
            return;
        }
        if (trigger === 'poll' && stat.mtimeMs === this.known.mtimeMs && stat.size === this.known.size) return;
        let text: string;
        try {
            text = await this.fs.read(this.path);
        } catch {
            return; // removed between stat and read; the next check reports it
        }
        const hash = sha256(text);
        // Same content (an own write, a touch, a checkout without change). A file that comes back is read again.
        if (hash === this.known.hash && this.state !== 'missing') {
            this.known = {...stat, hash};
            return;
        }
        this.known = {...stat, hash};
        this.ingest(text);
    }

    /** Applies a changed file to the document; in-memory changes stay on top (D7). */
    private ingest(text: string) {
        const parsed = parseMapFile(text);
        if (!parsed.ok) {
            this.update({state: 'invalid', diagnostics: parsed.diagnostics, changedOnDiskAt: now()});
            return;
        }
        const {tree, ...meta} = parsed.model;
        const next = reconcileTrees(this.syncedTree, tree);
        const ops = diffTrees(this.syncedTree, next);
        this.ingesting = true;
        try {
            if (ops.length) this.doc.apply(ops);
        } finally {
            this.ingesting = false;
        }
        this.syncedTree = next;
        this.meta = meta;
        this.update({state: 'clean', diagnostics: parsed.diagnostics, changedOnDiskAt: now()});
        // D8: write only when unwritten in-memory changes make the content differ from the file.
        if (contentDiffers(this.syncedTree, this.doc.tree)) this.requestWrite();
    }

    private async write() {
        for (let attempt = 0; ; attempt++) {
            const tree = this.doc.tree;
            if (!this.paused() && !contentDiffers(this.syncedTree, tree)) {
                this.update({state: this.writeQueued ? 'writing' : 'clean'});
                return;
            }
            // A save by another program between the check and the write would be lost: check the stamp again.
            const stat = await this.fs.stat(this.path);
            const moved = !stat || stat.mtimeMs !== this.known.mtimeMs || stat.size !== this.known.size;
            if (moved && attempt < 3 && !this.paused()) {
                await this.checkDisk('write');
                if (this.paused()) return;
                continue;
            }
            const text = serializeMapFile({...this.meta, tree});
            try {
                await this.fs.writeAtomic(this.path, text);
            } catch (err) {
                const message = `Cannot write the file: ${err instanceof Error ? err.message : String(err)}`;
                this.update({state: 'invalid', diagnostics: [{line: 1, severity: 'error', message}]});
                return;
            }
            const after = await this.fs.stat(this.path);
            this.known = {mtimeMs: after?.mtimeMs ?? 0, size: after?.size ?? 0, hash: sha256(text)};
            this.syncedTree = tree;
            this.update({
                state: this.writeQueued ? 'writing' : 'clean',
                diagnostics: this.state === 'clean' || this.state === 'writing' ? this.diagnostics : [],
                writtenAt: now(),
            });
            return;
        }
    }
}
