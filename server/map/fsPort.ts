import {watch} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The file system operations the map file code needs. `NodeFsPort` is the only module that imports `node:fs`;
 * tests use `MemoryFsPort` (server/map/testing/memoryFsPort.ts).
 */
export interface FsPort {
    /** `null` if the file does not exist. */
    stat(path: string): Promise<{mtimeMs: number; size: number} | null>;
    /** UTF-8 text. */
    read(path: string): Promise<string>;
    /** Writes a temp file in the same directory, then renames it over the target. */
    writeAtomic(path: string, text: string): Promise<void>;
    /** Calls `onChange` with the entry name for changes in `dir` (an empty name if unknown). Returns unsubscribe. */
    watchDir(dir: string, onChange: (fileName: string) => void): () => void;
    /** Direct entries only. */
    listDir(dir: string): Promise<{name: string; kind: 'dir' | 'file'}[]>;
    /** Resolves symlinks. Rejects if the path does not exist. */
    realpath(path: string): Promise<string>;
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT';

export class NodeFsPort implements FsPort {
    async stat(p: string) {
        try {
            const s = await fs.stat(p);
            return s.isFile() ? {mtimeMs: s.mtimeMs, size: s.size} : null;
        } catch (err) {
            if (isMissing(err)) return null;
            throw err;
        }
    }

    read(p: string) {
        return fs.readFile(p, 'utf8');
    }

    async writeAtomic(p: string, text: string) {
        const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.${Date.now()}.tmp`);
        try {
            await fs.writeFile(tmp, text, 'utf8');
            await fs.rename(tmp, p);
        } catch (err) {
            await fs.rm(tmp, {force: true});
            throw err;
        }
    }

    watchDir(dir: string, onChange: (fileName: string) => void) {
        try {
            const watcher = watch(dir, (_event, name) => onChange(name ? String(name) : ''));
            watcher.on('error', () => {}); // the directory went away; the poll reports the missing file
            return () => watcher.close();
        } catch {
            return () => {}; // the directory does not exist; the poll covers it
        }
    }

    async listDir(dir: string) {
        const entries = await fs.readdir(dir, {withFileTypes: true});
        const out: {name: string; kind: 'dir' | 'file'}[] = [];
        for (const e of entries) {
            let kind: 'dir' | 'file' | null = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : null;
            if (e.isSymbolicLink()) {
                const s = await fs.stat(path.join(dir, e.name)).catch(() => null);
                kind = s?.isDirectory() ? 'dir' : s?.isFile() ? 'file' : null;
            }
            if (kind) out.push({name: e.name, kind});
        }
        return out;
    }

    realpath(p: string) {
        return fs.realpath(p);
    }
}
