import {MindMap} from './mindmap';
import {fromOutline, createTree} from './mindmap/model/tree';
import type {LayoutKind} from './mindmap/model/types';
import {SAMPLES} from './mindmap/samples';

/**
 * Stand-alone app. State lives in memory only.
 * Query params (handy for demos and e2e tests): `?sample=software-factory&layout=logic`.
 */
export function App() {
    const params = new URLSearchParams(window.location.search);
    const sample = SAMPLES[params.get('sample') ?? ''];
    const layout = (['mindmap', 'logic', 'org'] as const).find((l) => l === params.get('layout')) as
        LayoutKind | undefined;
    return (
        <MindMap
            initialTree={sample ? fromOutline(sample) : createTree('Central Topic')}
            initialLayout={layout ?? 'mindmap'}
            style={{width: '100vw', height: '100vh'}}
        />
    );
}
