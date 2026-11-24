/**
 * The last opened map file, kept in browser storage so the app reopens it after a restart (D11). Storage can be
 * missing or throw (private windows, blocked site data, Node tests); then nothing is remembered.
 */
export const LAST_MAP_FILE_KEY = 'thinking-patterns.lastMapFile';

/** The stored absolute path, or `null` if none is stored or storage throws. */
export function loadLastMapFile(): string | null {
    try {
        return globalThis.localStorage?.getItem(LAST_MAP_FILE_KEY) ?? null;
    } catch {
        return null;
    }
}

/** Stores the path. Ignores storage errors. */
export function saveLastMapFile(path: string): void {
    try {
        globalThis.localStorage?.setItem(LAST_MAP_FILE_KEY, path);
    } catch {
        // not remembered
    }
}

/** Removes the stored path. Ignores storage errors. */
export function clearLastMapFile(): void {
    try {
        globalThis.localStorage?.removeItem(LAST_MAP_FILE_KEY);
    } catch {
        // nothing stored
    }
}
