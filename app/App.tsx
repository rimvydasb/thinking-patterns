import {useEffect, useRef, useState} from 'react';
import './ai/ai.css';
import {AiStatusChip, GenerationProgress, SettingsButton} from './ai/AiControls';
import {createBrainstorm, type Brainstorm} from './ai/brainstorm';
import {loadAiSettings, saveAiSettings, type AiSettings} from './ai/settings';
import {SettingsDialog} from './ai/SettingsDialog';
import {useBridgeStatus} from './ai/useBridgeStatus';
import {createMindMapStore, MindMap, useMindMapState} from './mindmap';
import {FileStatusBanner} from './mindmap/components/FileStatusBanner';
import {ImportExportMenu} from './mindmap/components/ImportExportMenu';
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

    const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
    const aiSettingsRef = useRef(aiSettings);
    aiSettingsRef.current = aiSettings;
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const {status: bridgeStatus, recheck: recheckBridge} = useBridgeStatus(aiSettings.serverUrl);
    const generatingCount = useMindMapState(store, (s) => Object.keys(s.generating).length);
    const [brainstorm, setBrainstorm] = useState<Brainstorm | null>(null);

    useEffect(() => {
        const b = createBrainstorm({
            store,
            settings: () => aiSettingsRef.current,
            onError: (message) => {
                setAiError(message);
                recheckBridge();
            },
        });
        setBrainstorm(b);
        return () => b.dispose();
    }, [store, recheckBridge]);

    // Errors stay on screen for a few seconds; a new generation hides them.
    useEffect(() => {
        if (!aiError) return;
        const timer = setTimeout(() => setAiError(null), 6000);
        return () => clearTimeout(timer);
    }, [aiError]);

    const closeSettings = () => {
        setSettingsOpen(false);
        document.querySelector<HTMLElement>('.mm-root')?.focus({preventScroll: true});
    };

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
            <MindMap
                store={store}
                style={{width: '100vw', height: '100vh'}}
                toolbarExtra={fileControls}
                onGenerateTopic={(where) => {
                    setAiError(null);
                    brainstorm?.generate(where);
                }}
            />
            <GenerationProgress count={generatingCount} error={aiError} />
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
                <AiStatusChip
                    status={bridgeStatus}
                    model={aiSettings.model}
                    onClick={() => setSettingsOpen(true)}
                />
                <SettingsButton onClick={() => setSettingsOpen(true)} />
                <ImportExportMenu store={store} />
            </div>
            {settingsOpen && (
                <SettingsDialog
                    settings={aiSettings}
                    onSave={(next) => {
                        saveAiSettings(next);
                        setAiSettings(next);
                        closeSettings();
                    }}
                    onClose={closeSettings}
                />
            )}
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
