import {useEffect, useState} from 'react';
import {createMindMapStore, MindMap} from './mindmap';
import {FileStatusBanner} from './mindmap/components/FileStatusBanner';
import {MapFilePicker} from './mindmap/components/MapFilePicker';
import {createTree, fromOutline} from './mindmap/model/tree';
import type {LayoutKind} from './mindmap/model/types';
import {SAMPLES} from './mindmap/samples';
import {saveLastMapFile} from './mindmap/sync/lastMapFile';
import {SYNC_PATH, type FileState} from './mindmap/sync/protocol';
import {connectSync, type SyncClient, type SyncStatus} from './mindmap/sync/syncClient';

/**
 * Stand-alone app.
 *
 * Query params:
 * - Default: the app syncs its map with the server, which stores it in a `.map.md` file. Agents (MCP) see the map
 *   and their changes show at once. The user picks the file in the app; the app reopens it after a restart.
 * - `?sample=<name>` or `?offline`: in-memory only, no server (demos and e2e tests).
 * - `?layout=mindmap|logic|org`.
 */
export function App() {
    const params = new URLSearchParams(window.location.search);
    const sample = SAMPLES[params.get('sample') ?? ''];
    const layout = (['mindmap', 'logic', 'org'] as const).find((l) => l === params.get('layout')) as
        LayoutKind | undefined;
    const offline = !!sample || params.has('offline');

    const [store] = useState(() =>
        createMindMapStore({
            tree: sample ? fromOutline(sample) : createTree('Central Topic'),
            layout: layout ?? 'mindmap',
        }),
    );
    const [status, setStatus] = useState<SyncStatus | null>(offline ? null : 'connecting');
    /** `undefined`: not known yet; `null`: no file open (the picker shows and cannot be dismissed). */
    const [file, setFile] = useState<FileState | null | undefined>(undefined);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [client, setClient] = useState<SyncClient | null>(null);

    useEffect(() => {
        if (offline) return;
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const c = connectSync({
            url: `${scheme}://${window.location.host}${SYNC_PATH}`,
            store,
            onStatus: setStatus,
            onFile: setFile,
        });
        setClient(c);
        return () => c.close();
    }, [offline, store]);

    const fileControls = !offline && (
        <div className="mm-group mf-toolbar-file" role="group" aria-label="Map file">
            <button
                type="button"
                className="mm-btn"
                title="Open or create a map file"
                data-testid="open-file"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPickerOpen(true)}
            >
                Open…
            </button>
            {file && (
                <span className="mf-toolbar-file__path" title={file.path} data-testid="file-path">
                    {file.path}
                </span>
            )}
        </div>
    );

    return (
        <>
            <MindMap store={store} style={{width: '100vw', height: '100vh'}} toolbarExtra={fileControls} />
            <div className="app-status">
                {file && (file.state === 'clean' || file.state === 'writing') && (
                    <div className={`app-file app-file--${file.state}`} data-testid="file-status">
                        {file.state === 'clean' ? 'Saved' : 'Saving…'}
                    </div>
                )}
                {status && (
                    <div className={`app-sync app-sync--${status}`} data-testid="sync-status">
                        {status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
                    </div>
                )}
            </div>
            {file && client && <FileStatusBanner file={file} onWrite={() => client.writeFile()} />}
            {(file === null || pickerOpen) && (
                <MapFilePicker
                    currentFile={file ?? null}
                    onOpened={(opened) => {
                        saveLastMapFile(opened.path);
                        setFile(opened);
                        setPickerOpen(false);
                    }}
                    onCancel={() => setPickerOpen(false)}
                />
            )}
        </>
    );
}
