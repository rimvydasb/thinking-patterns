import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {exportFileName, exportMarkdown, importMarkdown, titleFromFileName} from '../model/importExport';
import type {MindMapStore} from '../store/mindmapStore';
import '../importExport.css';

const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

/** Saves `text` as a file through the browser's download, without a server. */
function download(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Top-right import / export button with a menu. Everything runs in the browser: export downloads the map as a
 * `.map.md` file, import reads a local Markdown file and replaces the map (one undo step).
 */
export function ImportExportMenu({store}: {store: MindMapStore}) {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(() => setMessage(null), 5000);
        return () => clearTimeout(timer);
    }, [message]);

    const refocusMap = () => document.querySelector<HTMLElement>('.mm-root')?.focus({preventScroll: true});

    const onExport = () => {
        setOpen(false);
        const {tree} = store.getState();
        download(exportMarkdown(tree), exportFileName(tree));
        refocusMap();
    };

    const onImport = () => {
        setOpen(false);
        inputRef.current?.click();
    };

    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // Picking the same file again fires `change` again.
        if (!file) return;
        try {
            const text = await file.text();
            const result = importMarkdown(text, store.getState().tree, titleFromFileName(file.name));
            if (!result.ok) {
                setMessage({text: `Cannot import ${file.name}: ${result.error}`, error: true});
                return;
            }
            store.getState().setTree(result.tree);
            setMessage({text: `Imported ${file.name}`, error: false});
        } catch (err) {
            setMessage({text: `Cannot read ${file.name}: ${err}`, error: true});
        } finally {
            refocusMap();
        }
    };

    return (
        <div className="ie-menu" ref={rootRef}>
            <button
                type="button"
                className="ie-btn"
                title="Import / export Markdown"
                aria-label="Import / export Markdown"
                aria-haspopup="menu"
                aria-expanded={open}
                data-testid="import-export"
                onMouseDown={preventFocusSteal}
                onClick={() => setOpen((o) => !o)}
            >
                <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                >
                    <path d="M7 3v14M3 7l4-4 4 4M17 21V7M21 17l-4 4-4-4" />
                </svg>
            </button>
            {open && (
                <div className="ie-popup" role="menu" aria-label="Import / export">
                    <button
                        type="button"
                        role="menuitem"
                        className="ie-item"
                        data-testid="import-markdown"
                        onMouseDown={preventFocusSteal}
                        onClick={onImport}
                    >
                        Import Markdown…
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="ie-item"
                        data-testid="export-markdown"
                        onMouseDown={preventFocusSteal}
                        onClick={onExport}
                    >
                        Export Markdown
                    </button>
                </div>
            )}
            <input
                ref={inputRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                hidden
                data-testid="import-file"
                onChange={onFile}
            />
            {message && (
                <div
                    className={`ie-toast${message.error ? ' ie-toast--error' : ''}`}
                    role="status"
                    data-testid="import-status"
                >
                    {message.text}
                </div>
            )}
        </div>
    );
}
