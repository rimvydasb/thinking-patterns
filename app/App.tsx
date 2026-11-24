import {useEffect, useState} from 'react';
import {createMindMapStore, MindMap} from './mindmap';
import {createTree, fromOutline} from './mindmap/model/tree';
import type {LayoutKind} from './mindmap/model/types';
import {SAMPLES} from './mindmap/samples';
import {SYNC_PATH} from './mindmap/sync/protocol';
import {connectSync, type SyncStatus} from './mindmap/sync/syncClient';

/**
 * Stand-alone app.
 *
 * Query params:
 * - Default: the app syncs its map with the server, so agents (MCP) see it and their changes show at once.
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

    useEffect(() => {
        if (offline) return;
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const client = connectSync({
            url: `${scheme}://${window.location.host}${SYNC_PATH}`,
            store,
            onStatus: setStatus,
        });
        return () => client.close();
    }, [offline, store]);

    return (
        <>
            <MindMap store={store} style={{width: '100vw', height: '100vh'}} />
            {status && (
                <div className={`app-sync app-sync--${status}`} data-testid="sync-status">
                    {status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
                </div>
            )}
        </>
    );
}
