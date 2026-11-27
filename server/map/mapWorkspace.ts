import path from 'node:path';
import type {DirListing, FileState} from '../../app/mindmap/sync/protocol';
import {isMindMapFile, NOT_A_MIND_MAP} from '../../app/mindmap/model/mapFile/parse';
import {NodeFsPort, type FsPort} from './fsPort';
import {MapError} from './mapDocument';
import {MapFileError, openMapFile, type MapFileBinding} from './mapFileBinding';

/** Map files are Markdown files: any `.md` or `.markdown` name. */
const MARKDOWN_FILE = /\.(md|markdown)$/i;
const isMarkdownFileName = (name: string) => MARKDOWN_FILE.test(name) && !name.startsWith('.');

/** A request the workspace refuses. `status` is the HTTP status of the REST answer. */
export class WorkspaceError extends MapError {
    constructor(
        message: string,
        readonly status: 400 | 404 | 409,
    ) {
        super(message);
    }
}

/**
 * The maps root directory (`MAPS_DIR`) and the one open map file (D11). The GUI lists the root and opens a file by
 * its absolute path; the server reads and writes the file in place. Routes and MCP tools get the open file from
 * `current()` on each request and keep no reference across a switch.
 */
export interface MapWorkspace {
    /** Absolute path of `MAPS_DIR`. */
    readonly root: string;
    /** The open file, `null` before the first open. */
    current(): MapFileBinding | null;
    /** Subdirectories and Markdown (`*.md`, `*.markdown`) files of `dir` (default: the root). Rejects outside the root. */
    listDir(dir?: string): Promise<DirListing>;
    /**
     * Closes the current file and opens `path`. Opening the open file again changes nothing.
     * `trusted` skips the root check (the `MAP_FILE` setting).
     */
    open(path: string, opts?: {create?: boolean; trusted?: boolean}): Promise<FileState>;
    /** Open file changes. Returns unsubscribe. */
    subscribe(listener: (binding: MapFileBinding | null) => void): () => void;
    /** Closes the current file. */
    close(): Promise<void>;
}

const HIDDEN_DIRS = new Set(['node_modules']);

export function createMapWorkspace(root: string, opts: {fs?: FsPort; pollMs?: number} = {}): MapWorkspace {
    const fs = opts.fs ?? new NodeFsPort();
    const absRoot = path.resolve(root);
    let realRoot: Promise<string> | null = null;
    let binding: MapFileBinding | null = null;
    let chain: Promise<unknown> = Promise.resolve();
    const listeners = new Set<(b: MapFileBinding | null) => void>();

    const rootPath = () => (realRoot ??= fs.realpath(absRoot));
    const inside = (real: string, base: string) => real === base || real.startsWith(base + path.sep);

    /** Real path of an existing path inside the root, or a 400/404 `WorkspaceError`. */
    const resolveInside = async (p: string, what: string): Promise<string> => {
        if (!path.isAbsolute(p)) throw new WorkspaceError(`The ${what} path must be absolute: ${p}`, 400);
        const base = await rootPath();
        let real: string;
        try {
            real = await fs.realpath(p);
        } catch {
            // Not there: answer 404 only for a path that would be inside the root.
            const parent = await fs.realpath(path.dirname(p)).catch(() => null);
            if (!parent || !inside(parent, base))
                throw new WorkspaceError(`The ${what} is outside the maps directory.`, 400);
            throw new WorkspaceError(`The ${what} does not exist: ${p}`, 404);
        }
        if (!inside(real, base)) throw new WorkspaceError(`The ${what} is outside the maps directory.`, 400);
        return real;
    };

    const serial = <T>(task: () => Promise<T>): Promise<T> => {
        const run = chain.then(task);
        chain = run.catch(() => {});
        return run;
    };

    const emit = () => {
        for (const l of listeners) l(binding);
    };

    const switchTo = async (target: string, create: boolean): Promise<FileState> => {
        if (create && (await fs.stat(target))) throw new WorkspaceError(`The file already exists: ${target}`, 409);
        if (binding && binding.fileState().path === target) return binding.fileState();
        // Refuse a Markdown file that is not a mind map before the open file is closed, so it stays open.
        if (!create && (await fs.stat(target)) && !isMindMapFile(await fs.read(target))) {
            throw new WorkspaceError(`${NOT_A_MIND_MAP} ${target}`, 400);
        }
        const previous = binding;
        binding = null;
        if (previous) await previous.close();
        try {
            binding = await openMapFile(target, {fs, pollMs: opts.pollMs, create});
        } catch (err) {
            if (previous) emit();
            if (err instanceof MapFileError) {
                throw new WorkspaceError(
                    err.message,
                    err.code === 'exists' ? 409 : err.code === 'not-mindmap' ? 400 : 404,
                );
            }
            throw err;
        }
        emit();
        return binding.fileState();
    };

    return {
        root: absRoot,
        current: () => binding,

        async listDir(dir) {
            const base = await rootPath();
            const real = dir === undefined ? base : await resolveInside(dir, 'directory');
            let entries;
            try {
                entries = await fs.listDir(real);
            } catch {
                throw new WorkspaceError(`Not a directory: ${dir}`, 400);
            }
            const visible = entries.filter((e) =>
                e.kind === 'dir' ? !e.name.startsWith('.') && !HIDDEN_DIRS.has(e.name) : isMarkdownFileName(e.name),
            );
            const byName = (a: {name: string}, b: {name: string}) => a.name.localeCompare(b.name);
            const pick = (kind: 'dir' | 'file') =>
                visible
                    .filter((e) => e.kind === kind)
                    .sort(byName)
                    .map((e) => ({name: e.name, path: path.join(real, e.name), kind}));
            return {
                root: base,
                dir: real,
                parent: real === base ? null : path.dirname(real),
                entries: [...pick('dir'), ...pick('file')],
            };
        },

        open(p, o = {}) {
            return serial(async () => {
                if (o.trusted) {
                    const abs = path.resolve(p);
                    const target = o.create ? abs : await fs.realpath(abs).catch(() => abs);
                    return switchTo(target, !!o.create);
                }
                if (!path.isAbsolute(p)) throw new WorkspaceError(`The file path must be absolute: ${p}`, 400);
                if (!MARKDOWN_FILE.test(p)) {
                    throw new WorkspaceError(`A map file must be a Markdown file (.md or .markdown): ${p}`, 400);
                }
                if (o.create) {
                    const dir = await resolveInside(path.dirname(p), 'directory');
                    const name = path.basename(p);
                    if (!isMarkdownFileName(name)) {
                        throw new WorkspaceError(`Invalid map file name: ${name}`, 400);
                    }
                    return switchTo(path.join(dir, name), true);
                }
                const real = await resolveInside(p, 'file');
                if (!MARKDOWN_FILE.test(real)) {
                    throw new WorkspaceError(`A map file must be a Markdown file (.md or .markdown): ${real}`, 400);
                }
                return switchTo(real, false);
            });
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },

        close() {
            return serial(async () => {
                const previous = binding;
                binding = null;
                if (previous) {
                    await previous.close();
                    emit();
                }
            });
        },
    };
}
