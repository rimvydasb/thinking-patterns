import type {MindMapStore} from '../mindmap/store/mindmapStore';
import {complete} from './bridgeApi';
import type {AiSettings} from './settings';
import {getNode} from '../mindmap/model/tree';
import {buildTopicRequest, cleanTopicAnswer, cleanTopicList} from './topicPrompt';

export interface Brainstorm {
    /**
     * Adds a topic at once (child or next sibling of the selection) and lets the AI name it. A child of a topic
     * that has no children yet asks for a list instead: up to 10 children, the first one in the new topic.
     */
    generate(where: 'child' | 'sibling'): void;
    /** Stops all waiting and running generations. */
    dispose(): void;
}

/**
 * Generates topic names one after the other, so each request already sees the names generated before it (pressing
 * Shift+Enter three times gives three different fruits, not three apples).
 */
export function createBrainstorm(opts: {
    store: MindMapStore;
    settings(): AiSettings;
    onError(message: string): void;
    /** Overridable for tests. */
    complete?: typeof complete;
}): Brainstorm {
    const ask = opts.complete ?? complete;
    const abort = new AbortController();
    let queue: Promise<void> = Promise.resolve();

    const run = async (id: string, list: boolean) => {
        const {store} = opts;
        if (abort.signal.aborted) return store.getState().resolvePending(id, null);
        const state = store.getState();
        if (!state.tree.nodes[id] || !state.generating[id]) return state.resolvePending(id, null);
        const settings = opts.settings();
        try {
            const request = buildTopicRequest(state.tree, id, (n) => !!state.generating[n], list);
            const answer = await ask({
                url: settings.serverUrl,
                model: settings.model,
                timeoutMs: settings.timeoutSec * 1000,
                signal: abort.signal,
                messages: [
                    {role: 'system', content: list ? settings.topicListPrompt : settings.topicPrompt},
                    {role: 'user', content: request},
                ],
            });
            const now = store.getState().tree;
            const parentId = now.nodes[id]?.parentId;
            const existing = parentId
                ? getNode(now, parentId)
                      .children.filter((c) => c !== id)
                      .map((c) => now.nodes[c].text)
                : [];
            const texts = list ? cleanTopicList(answer, existing) : [cleanTopicAnswer(answer)].filter(Boolean);
            if (!texts.length) throw new Error('The AI gave an empty answer.');
            store.getState().resolvePending(id, texts[0], texts.slice(1));
        } catch (error) {
            store.getState().resolvePending(id, null);
            if (!abort.signal.aborted) opts.onError(error instanceof Error ? error.message : String(error));
        }
    };

    return {
        generate(where) {
            const s = opts.store.getState();
            const list = where === 'child' && s.tree.nodes[s.selectedId].children.length === 0;
            const id = s.addPending(where);
            queue = queue.then(() => run(id, list));
        },
        dispose() {
            abort.abort();
        },
    };
}
