import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {createMapFilesApi, type MapFilesApi} from '../sync/mapFilesApi';
import type {DirListing, FileState} from '../sync/protocol';
import '../mapFile.css';

/** Any Markdown file can hold a map. A new name without one of these extensions gets `.md`. */
const MARKDOWN_FILE = /\.(md|markdown)$/i;

export interface MapFilePickerProps {
    /** `null`: no file is open. Closing the picker then leaves the map unsaved until a file is opened. */
    currentFile: FileState | null;
    /** Called after `POST /api/map/open` succeeds. */
    onOpened(file: FileState): void;
    /** Closes the picker (close button or Escape). */
    onCancel(): void;
    /** REST calls. Default: the server of the page. Stories pass a fake. */
    api?: MapFilesApi;
}

/** Path separator of the server, from the paths it returns. */
const sepOf = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');

/** The crumbs from the maps root to `dir`. */
function crumbs(listing: DirListing): {name: string; path: string}[] {
    const sep = sepOf(listing.root);
    const rootName = listing.root.split(sep).filter(Boolean).pop() ?? listing.root;
    const out = [{name: rootName, path: listing.root}];
    const rest = listing.dir.slice(listing.root.length).split(sep).filter(Boolean);
    rest.forEach((part, i) => out.push({name: part, path: [listing.root, ...rest.slice(0, i + 1)].join(sep)}));
    return out;
}

/**
 * Picks the map file from a listing of the server's maps directory and opens it by its absolute path (D11). It can
 * also create a new map. Any `.md` / `.markdown` file can be opened. Switching away from an `invalid` or `missing` file drops the unwritten changes, so the
 * picker asks first.
 */
export function MapFilePicker({currentFile, onOpened, onCancel, api: givenApi}: MapFilePickerProps) {
    const api = useMemo(() => givenApi ?? createMapFilesApi(), [givenApi]);
    const [listing, setListing] = useState<DirListing | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [newName, setNewName] = useState('');
    const [confirm, setConfirm] = useState<{path: string; create: boolean} | null>(null);
    const risky = currentFile?.state === 'invalid' || currentFile?.state === 'missing';

    const load = useCallback(
        (dir?: string) => {
            setError(null);
            api.listFiles(dir).then(setListing, (err: Error) => setError(err.message));
        },
        [api],
    );

    useEffect(() => {
        const sep = currentFile ? sepOf(currentFile.path) : '/';
        const dir = currentFile ? currentFile.path.slice(0, currentFile.path.lastIndexOf(sep)) : undefined;
        api.listFiles(dir).then(setListing, () => load());
        // Only on mount: start in the directory of the open file.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    const open = (path: string, create: boolean, confirmed = false) => {
        if (path === currentFile?.path && !create) return onCancel();
        if (risky && !confirmed) return setConfirm({path, create});
        setConfirm(null);
        setBusy(true);
        setError(null);
        api.openFile(path, {create}).then(
            (file) => {
                setBusy(false);
                onOpened(file);
            },
            (err: Error) => {
                setBusy(false);
                setError(err.message);
            },
        );
    };

    const create = (e: FormEvent) => {
        e.preventDefault();
        const name = newName.trim();
        if (!listing || !name) return;
        const file = MARKDOWN_FILE.test(name) ? name : `${name}.md`;
        open(`${listing.dir}${sepOf(listing.dir)}${file}`, true);
    };

    return (
        <div className="mf-backdrop" data-testid="map-file-picker">
            <div className="mf-dialog" role="dialog" aria-modal="true" aria-labelledby="mf-title">
                <header className="mf-dialog__header">
                    <h2 id="mf-title">Open a map file</h2>
                    <button
                        type="button"
                        className="mf-close"
                        title="Close"
                        aria-label="Close"
                        data-testid="picker-close"
                        onClick={onCancel}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden
                        >
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </header>

                {listing && (
                    <nav className="mf-crumbs" aria-label="Folder" data-testid="picker-crumbs">
                        {crumbs(listing).map((c, i, all) => (
                            <span key={c.path}>
                                {i > 0 && <span className="mf-crumbs__sep">/</span>}
                                {i === all.length - 1 ? (
                                    <span aria-current="location">{c.name}</span>
                                ) : (
                                    <button type="button" className="mf-link" onClick={() => load(c.path)}>
                                        {c.name}
                                    </button>
                                )}
                            </span>
                        ))}
                    </nav>
                )}

                {confirm ? (
                    <div className="mf-confirm" role="alertdialog" data-testid="picker-confirm">
                        <p>
                            The open file is {currentFile?.state === 'missing' ? 'missing' : 'invalid'}, so its changes
                            in the app are not saved. They are lost if you open another file.
                        </p>
                        <div className="mf-confirm__actions">
                            <button type="button" className="mf-button" onClick={() => setConfirm(null)}>
                                Back
                            </button>
                            <button
                                type="button"
                                className="mf-button mf-button--danger"
                                data-testid="picker-confirm-open"
                                onClick={() => open(confirm.path, confirm.create, true)}
                            >
                                Open anyway
                            </button>
                        </div>
                    </div>
                ) : (
                    <ul className="mf-list" data-testid="picker-entries" aria-busy={busy}>
                        {listing?.parent && (
                            <li>
                                <button
                                    type="button"
                                    className="mf-entry"
                                    data-testid="picker-up"
                                    onClick={() => load(listing.parent!)}
                                >
                                    <span className="mf-entry__icon" aria-hidden>
                                        ↩
                                    </span>
                                    ..
                                </button>
                            </li>
                        )}
                        {listing?.entries.map((e) => (
                            <li key={e.path}>
                                <button
                                    type="button"
                                    className="mf-entry"
                                    data-testid={e.kind === 'dir' ? 'picker-dir' : 'picker-file'}
                                    aria-current={e.path === currentFile?.path ? 'true' : undefined}
                                    disabled={busy}
                                    onClick={() => (e.kind === 'dir' ? load(e.path) : open(e.path, false))}
                                >
                                    <span className="mf-entry__icon" aria-hidden>
                                        {e.kind === 'dir' ? '📁' : '🧠'}
                                    </span>
                                    {e.name}
                                </button>
                            </li>
                        ))}
                        {listing && listing.entries.length === 0 && (
                            <li className="mf-empty">No folders or Markdown files here.</li>
                        )}
                    </ul>
                )}

                <form className="mf-new" onSubmit={create}>
                    <label htmlFor="mf-new-name">New map</label>
                    <input
                        id="mf-new-name"
                        data-testid="picker-new-name"
                        placeholder="name.md"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="mf-button mf-button--primary"
                        data-testid="picker-create"
                        disabled={busy || !newName.trim() || !listing}
                    >
                        Create
                    </button>
                </form>

                {error && (
                    <p className="mf-error" role="alert" data-testid="picker-error">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}
