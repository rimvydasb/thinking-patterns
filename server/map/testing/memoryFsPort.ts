import path from 'node:path';
import type {FsPort} from '../fsPort';

interface MemFile {
    text: string;
    mtimeMs: number;
}

/**
 * An in-memory `FsPort` for tests. Paths are POSIX paths. The clock is manual (`mtimeMs` grows by 1 per write unless
 * a test sets it), so tests can simulate same-second writes and `touch`. `symlinks` maps a link path to its target.
 */
export class MemoryFsPort implements FsPort {
    readonly files = new Map<string, MemFile>();
    readonly dirs = new Set<string>(['/']);
    readonly symlinks = new Map<string, string>();
    /** Set to `false` to simulate missed watch events (only the poll then sees changes). */
    watchEnabled = true;
    /** Called before `writeAtomic` renames the temp file; tests use it to race an editor save. */
    beforeRename: ((p: string) => void) | null = null;
    private clock = 1000;
    private readonly watchers = new Set<{dir: string; onChange: (name: string) => void}>();

    /** Writes a file as another program would (an editor, an agent, `git checkout`). */
    writeExternal(p: string, text: string, opts: {mtimeMs?: number; silent?: boolean} = {}) {
        this.mkdirp(path.posix.dirname(p));
        this.files.set(p, {text, mtimeMs: opts.mtimeMs ?? this.tick()});
        if (!opts.silent) this.notify(p);
    }

    /** Changes the modification time only. */
    touch(p: string) {
        const f = this.files.get(p);
        if (!f) throw new Error(`no file ${p}`);
        f.mtimeMs = this.tick();
        this.notify(p);
    }

    remove(p: string) {
        this.files.delete(p);
        this.notify(p);
    }

    text(p: string): string | undefined {
        return this.files.get(p)?.text;
    }

    mkdirp(dir: string) {
        for (let d = dir; !this.dirs.has(d); d = path.posix.dirname(d)) this.dirs.add(d);
    }

    async stat(p: string) {
        const f = this.files.get(this.resolve(p));
        return f ? {mtimeMs: f.mtimeMs, size: Buffer.byteLength(f.text)} : null;
    }

    async read(p: string) {
        const f = this.files.get(this.resolve(p));
        if (!f) throw Object.assign(new Error(`ENOENT: ${p}`), {code: 'ENOENT'});
        return f.text;
    }

    async writeAtomic(p: string, text: string) {
        if (!this.dirs.has(path.posix.dirname(p))) throw Object.assign(new Error(`ENOENT: ${p}`), {code: 'ENOENT'});
        await Promise.resolve();
        this.beforeRename?.(p);
        this.files.set(p, {text, mtimeMs: this.tick()});
        this.notify(p);
    }

    watchDir(dir: string, onChange: (fileName: string) => void) {
        const w = {dir, onChange};
        this.watchers.add(w);
        return () => void this.watchers.delete(w);
    }

    async listDir(dir: string) {
        const real = this.resolve(dir);
        if (!this.dirs.has(real)) throw Object.assign(new Error(`ENOENT: ${dir}`), {code: 'ENOENT'});
        const out: {name: string; kind: 'dir' | 'file'}[] = [];
        for (const d of this.dirs)
            if (d !== real && path.posix.dirname(d) === real) out.push({name: path.posix.basename(d), kind: 'dir'});
        for (const f of this.files.keys())
            if (path.posix.dirname(f) === real) out.push({name: path.posix.basename(f), kind: 'file'});
        return out;
    }

    async realpath(p: string) {
        const real = this.resolve(path.posix.resolve(p));
        if (!this.files.has(real) && !this.dirs.has(real)) {
            throw Object.assign(new Error(`ENOENT: ${p}`), {code: 'ENOENT'});
        }
        return real;
    }

    /** Resolves symlinks in any part of the path. */
    private resolve(p: string): string {
        const parts = path.posix.normalize(p).split('/').filter(Boolean);
        let cur = '/';
        for (const part of parts) {
            cur = path.posix.join(cur, part);
            const target = this.symlinks.get(cur);
            if (target) cur = target;
        }
        return cur;
    }

    private tick() {
        this.clock += 1;
        return this.clock;
    }

    private notify(p: string) {
        if (!this.watchEnabled) return;
        for (const w of this.watchers) if (w.dir === path.posix.dirname(p)) w.onChange(path.posix.basename(p));
    }
}
