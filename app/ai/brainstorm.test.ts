import {fromOutline} from '../mindmap/model/tree';
import {createMindMapStore, PENDING_TEXT} from '../mindmap/store/mindmapStore';
import {createBrainstorm} from './brainstorm';
import {DEFAULT_AI_SETTINGS} from './settings';
import {buildTopicRequest, cleanTopicAnswer, cleanTopicList} from './topicPrompt';

const food = () =>
    fromOutline({text: 'Food', children: [{text: 'Fruits', children: [{text: 'Apple'}]}, {text: 'Vegetables'}]});

function storeOn(text: string) {
    const tree = food();
    const id = Object.values(tree.nodes).find((n) => n.text === text)!.id;
    return createMindMapStore({tree, selectedId: id});
}

const texts = (store: ReturnType<typeof storeOn>, parent: string) => {
    const {nodes} = store.getState().tree;
    const p = Object.values(nodes).find((n) => n.text === parent)!;
    return p.children.map((c) => nodes[c].text);
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('cleanTopicAnswer', () => {
    it.each([
        ['Banana', 'Banana'],
        ['  "Banana."\n', 'Banana'],
        ['- Banana\n- Cherry', 'Banana'],
        ['2. Mango', 'Mango'],
        ['Topic: **Kiwi**', 'Kiwi'],
        ['\n\n', ''],
    ])('%j -> %j', (answer, expected) => {
        expect(cleanTopicAnswer(answer)).toBe(expected);
    });
});

describe('cleanTopicList', () => {
    it('cleans each line, drops blanks, duplicates and existing names, and keeps at most 10', () => {
        expect(cleanTopicList('1. Apple\n\n- banana\nBanana\nCherry.', ['apple'])).toEqual(['banana', 'Cherry']);
        const many = Array.from({length: 15}, (_, i) => `Item ${i}`).join('\n');
        expect(cleanTopicList(many)).toHaveLength(10);
    });
});

describe('buildTopicRequest', () => {
    it('lists the path, the existing siblings and the parent siblings, without pending topics', () => {
        const store = storeOn('Apple');
        const first = store.getState().addPending('sibling');
        const second = store.getState().addPending('sibling');
        const s = store.getState();
        const request = buildTopicRequest(s.tree, second, (id) => !!s.generating[id]);
        expect(request).toContain('Mind map path: Food > Fruits');
        expect(request).toContain('Topics next to "Fruits":\n- Vegetables');
        expect(request).toContain('Existing topics under "Fruits":\n- Apple');
        expect(request).not.toContain(PENDING_TEXT);
        expect(first).not.toBe(second);
    });

    it('asks for a first topic when the parent has no children yet', () => {
        const store = storeOn('Vegetables');
        const id = store.getState().addPending('child');
        const s = store.getState();
        expect(buildTopicRequest(s.tree, id, (n) => !!s.generating[n])).toContain('(none yet)');
    });
});

describe('store: pending topics', () => {
    it('adds a selected placeholder at once; the generated text is not a separate undo step', () => {
        const store = storeOn('Apple');
        const id = store.getState().addPending('sibling');
        expect(store.getState().selectedId).toBe(id);
        expect(store.getState().editing).toBeNull();
        expect(store.getState().generating[id]).toBe(true);
        expect(texts(store, 'Fruits')).toEqual(['Apple', PENDING_TEXT]);

        store.getState().resolvePending(id, 'Banana');
        expect(texts(store, 'Fruits')).toEqual(['Apple', 'Banana']);
        expect(store.getState().generating).toEqual({});

        store.getState().undo();
        expect(texts(store, 'Fruits')).toEqual(['Apple']);
    });

    it('uses the default text when generation fails and keeps a topic the user renamed', () => {
        const store = storeOn('Fruits');
        const a = store.getState().addPending('child');
        store.getState().resolvePending(a, null);
        expect(store.getState().tree.nodes[a].text).toBe('Subtopic');

        const b = store.getState().addPending('sibling');
        store.getState().startEditing(b);
        store.getState().commitEdit('Mine');
        store.getState().resolvePending(b, 'Generated');
        expect(store.getState().tree.nodes[b].text).toBe('Mine');
    });
});

describe('createBrainstorm', () => {
    it('generates one after the other, so each request sees the names before it', async () => {
        const store = storeOn('Apple');
        const requests: string[] = [];
        const answers = ['Banana', 'Cherry'];
        const brainstorm = createBrainstorm({
            store,
            settings: () => DEFAULT_AI_SETTINGS,
            onError: () => {
                throw new Error('unexpected error');
            },
            complete: async ({messages}) => {
                requests.push(messages[1].content);
                return answers.shift()!;
            },
        });
        brainstorm.generate('sibling');
        brainstorm.generate('sibling');
        expect(texts(store, 'Fruits')).toEqual(['Apple', PENDING_TEXT, PENDING_TEXT]);

        await flush();
        await flush();
        expect(texts(store, 'Fruits')).toEqual(['Apple', 'Banana', 'Cherry']);
        expect(requests[1]).toContain('- Banana');
        expect(store.getState().generating).toEqual({});
    });

    it('Shift+Tab on a topic without children asks for a list and adds all of it in one undo step', async () => {
        const store = storeOn('Vegetables');
        const prompts: string[] = [];
        const brainstorm = createBrainstorm({
            store,
            settings: () => DEFAULT_AI_SETTINGS,
            onError: (m) => {
                throw new Error(m);
            },
            complete: async ({messages}) => {
                prompts.push(messages[0].content);
                return 'Carrot\nPotato\nOnion';
            },
        });
        brainstorm.generate('child');
        expect(texts(store, 'Vegetables')).toEqual([PENDING_TEXT]);
        await flush();
        expect(prompts).toEqual([DEFAULT_AI_SETTINGS.topicListPrompt]);
        expect(texts(store, 'Vegetables')).toEqual(['Carrot', 'Potato', 'Onion']);
        expect(store.getState().tree.nodes[store.getState().selectedId].text).toBe('Carrot');

        store.getState().undo();
        expect(texts(store, 'Vegetables')).toEqual([]);
    });

    it('Shift+Tab on a topic that has children asks for one topic', async () => {
        const store = storeOn('Fruits');
        const prompts: string[] = [];
        const brainstorm = createBrainstorm({
            store,
            settings: () => DEFAULT_AI_SETTINGS,
            onError: (m) => {
                throw new Error(m);
            },
            complete: async ({messages}) => {
                prompts.push(messages[0].content);
                return 'Banana\nCherry';
            },
        });
        brainstorm.generate('child');
        await flush();
        expect(prompts).toEqual([DEFAULT_AI_SETTINGS.topicPrompt]);
        expect(texts(store, 'Fruits')).toEqual(['Apple', 'Banana']);
    });

    it('reports errors and leaves a default-named topic', async () => {
        const store = storeOn('Fruits');
        const errors: string[] = [];
        const brainstorm = createBrainstorm({
            store,
            settings: () => DEFAULT_AI_SETTINGS,
            onError: (m) => errors.push(m),
            complete: async () => {
                throw new Error('AI server not reachable');
            },
        });
        brainstorm.generate('child');
        await flush();
        expect(errors).toEqual(['AI server not reachable']);
        expect(texts(store, 'Fruits')).toEqual(['Apple', 'Subtopic']);
    });
});
