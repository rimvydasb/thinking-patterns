import {createContext, useContext} from 'react';
import {createStore, useStore, type StoreApi} from 'zustand';
import {applyOps, type MapOp} from '../model/ops';
import * as T from '../model/tree';
import type {ArrowKey} from '../model/tree';
import type {LayoutKind, MindMapTree, NodeId} from '../model/types';

const HISTORY_LIMIT = 200;

/** Text of a topic while its name is being generated. */
export const PENDING_TEXT = '…';

export interface EditingState {
    id: NodeId;
    /** Text to start with (typing on a selected topic replaces its text). `null` = current text, all selected. */
    seed: string | null;
}

export interface MindMapState {
    tree: MindMapTree;
    layout: LayoutKind;
    /** The focused topic: keyboard actions, editing and the toolbar act on it. */
    selectedId: NodeId;
    /**
     * All selected topics (Ctrl/Cmd+click adds more), in the order they were selected. Always contains `selectedId`.
     * Selecting a topic any other way (click, arrows, new topic) makes it the only selected one again.
     */
    selectedIds: readonly NodeId[];
    editing: EditingState | null;
    past: MindMapTree[];
    future: MindMapTree[];
    /** Topics whose text is being generated (they show a spinner). */
    generating: Readonly<Record<NodeId, true>>;

    select(id: NodeId): void;
    /** Adds a topic to the selection, or removes it if it is already selected (Ctrl/Cmd+click). */
    toggleSelect(id: NodeId): void;
    navigate(key: ArrowKey): void;
    startEditing(id?: NodeId, seed?: string | null): void;
    commitEdit(text: string): void;
    cancelEdit(): void;
    addChild(): void;
    addSibling(position?: 'before' | 'after'): void;
    addParent(): void;
    /**
     * Adds a child (`child`) or a following sibling (`sibling`) of the selected topic with placeholder text, selects
     * it and marks it as generating. Returns the new id. Call `resolvePending` when its text is known.
     */
    addPending(where: 'child' | 'sibling'): NodeId;
    /**
     * Ends generation of a pending topic. `text` replaces the placeholder (not as a separate undo step: undo removes
     * the whole topic). `null` (failed) puts the default text in. A topic that was edited or removed meanwhile is
     * left as it is. `more` are further topics added right after it as siblings (a generated list), in the same
     * undo step.
     */
    resolvePending(id: NodeId, text: string | null, more?: readonly string[]): void;
    deleteSelected(): void;
    toggleCollapse(id?: NodeId): void;
    moveSelected(delta: number): void;
    /** Re-parents a topic (with its subtree) as the last child of `parentId`, and selects it. Refuses cycles. */
    moveTopic(id: NodeId, parentId: NodeId): void;
    /**
     * Moves several topics under `parentId` in one undo step, keeping their map order. Topics inside another moved
     * topic go along with it; topics that already are children of `parentId`, or would create a cycle, are skipped.
     */
    moveTopics(ids: readonly NodeId[], parentId: NodeId): void;
    undo(): void;
    redo(): void;
    setLayout(layout: LayoutKind): void;
    setTree(tree: MindMapTree): void;
    /**
     * Shows a change that someone else made (server, agent). It is not recorded for undo: `ops` are replayed on
     * the undo/redo history, so undo reverts only the user's own edits. `ops: null` replaces the content and
     * clears the history.
     */
    applyRemote(tree: MindMapTree, ops: readonly MapOp[] | null): void;
}

export type MindMapStore = StoreApi<MindMapState>;

export interface CreateStoreOptions {
    tree?: MindMapTree;
    layout?: LayoutKind;
    selectedId?: NodeId;
}

export function createMindMapStore(opts: CreateStoreOptions = {}): MindMapStore {
    const initial = opts.tree ?? T.createTree();
    return createStore<MindMapState>()((rawSet, get) => {
        /**
         * Sets state and keeps the selection consistent: a new `selectedId` (without explicit `selectedIds`) resets
         * the selection to that topic, and selected topics that were removed or hidden are dropped.
         */
        const set = (patch: Partial<MindMapState>) => {
            const s = get();
            const tree = patch.tree ?? s.tree;
            const selectedId = patch.selectedId ?? s.selectedId;
            let ids = patch.selectedIds ?? (selectedId === s.selectedId ? s.selectedIds : [selectedId]);
            if (patch.tree || patch.selectedIds)
                ids = ids.filter((id) => tree.nodes[id] && safeSelection(tree, id) === id);
            if (!ids.includes(selectedId)) ids = [...ids, selectedId];
            rawSet(
                ids.length === s.selectedIds.length && ids.every((id, i) => id === s.selectedIds[i])
                    ? patch
                    : {...patch, selectedIds: ids},
            );
        };

        /** Applies a tree change and records it for undo. */
        const commit = (tree: MindMapTree, patch: Partial<MindMapState> = {}) => {
            const s = get();
            if (tree === s.tree) {
                if (Object.keys(patch).length) set(patch);
                return;
            }
            set({...patch, tree, past: [...s.past, s.tree].slice(-HISTORY_LIMIT), future: []});
        };

        /** Fixes the selection if the selected node no longer exists or became hidden. */
        const safeSelection = (tree: MindMapTree, id: NodeId): NodeId => {
            if (!tree.nodes[id]) return tree.rootId;
            const path = T.pathTo(tree, id);
            const hiddenBy = path.slice(0, -1).find((p) => tree.nodes[p].collapsed);
            return hiddenBy ?? id;
        };

        return {
            tree: initial,
            layout: opts.layout ?? 'mindmap',
            selectedId: opts.selectedId && initial.nodes[opts.selectedId] ? opts.selectedId : initial.rootId,
            selectedIds: [opts.selectedId && initial.nodes[opts.selectedId] ? opts.selectedId : initial.rootId],
            editing: null,
            past: [],
            future: [],
            generating: {},

            select: (id) => {
                if (get().tree.nodes[id]) set({selectedId: id, selectedIds: [id]});
            },

            toggleSelect: (id) => {
                const {tree, selectedIds} = get();
                if (!tree.nodes[id]) return;
                if (!selectedIds.includes(id)) return set({selectedId: id, selectedIds: [...selectedIds, id]});
                const rest = selectedIds.filter((x) => x !== id);
                if (rest.length) set({selectedId: rest[rest.length - 1], selectedIds: rest});
            },

            navigate: (key) => {
                const {tree, selectedId, layout} = get();
                set({selectedId: T.navigate(tree, selectedId, key, layout)});
            },

            startEditing: (id, seed = null) => {
                const target = id ?? get().selectedId;
                if (get().tree.nodes[target]) set({selectedId: target, editing: {id: target, seed}});
            },

            commitEdit: (text) => {
                const {editing, tree} = get();
                if (!editing || !tree.nodes[editing.id]) return set({editing: null});
                const clean = text.replace(/\s+$/g, '');
                const next = clean.trim() ? T.updateText(tree, editing.id, clean) : tree;
                commit(next, {editing: null});
            },

            cancelEdit: () => set({editing: null}),

            addChild: () => {
                const {tree, selectedId} = get();
                const r = T.addChild(tree, selectedId);
                commit(r.tree, {selectedId: r.id, editing: {id: r.id, seed: null}});
            },

            addSibling: (position = 'after') => {
                const {tree, selectedId} = get();
                const r = T.addSibling(tree, selectedId, position);
                commit(r.tree, {selectedId: r.id, editing: {id: r.id, seed: null}});
            },

            addParent: () => {
                const {tree, selectedId} = get();
                if (selectedId === tree.rootId) return;
                const r = T.addParent(tree, selectedId);
                commit(r.tree, {selectedId: r.id, editing: {id: r.id, seed: null}});
            },

            addPending: (where) => {
                const {tree, selectedId, generating} = get();
                const r =
                    where === 'child'
                        ? T.addChild(tree, selectedId, {text: PENDING_TEXT})
                        : T.addSibling(tree, selectedId, 'after', {text: PENDING_TEXT});
                commit(r.tree, {selectedId: r.id, editing: null, generating: {...generating, [r.id]: true}});
                return r.id;
            },

            resolvePending: (id, text, more = []) => {
                const {tree, generating} = get();
                const {[id]: _done, ...rest} = generating;
                const node = tree.nodes[id];
                if (!node) return set({generating: rest});
                let next =
                    node.text === PENDING_TEXT
                        ? T.updateText(tree, id, text?.trim() || T.defaultTextFor(T.depthOf(tree, id)))
                        : tree;
                let after = id;
                for (const extra of more) {
                    if (!extra.trim()) continue;
                    const r = T.addSibling(next, after, 'after', {text: extra.trim()});
                    next = r.tree;
                    after = r.id;
                }
                set({tree: next, generating: rest});
            },

            deleteSelected: () => {
                const {tree, selectedId} = get();
                if (selectedId === tree.rootId) return;
                const r = T.removeNode(tree, selectedId);
                commit(r.tree, {selectedId: r.nextSelection, editing: null});
            },

            toggleCollapse: (id) => {
                const {tree, selectedId} = get();
                const target = id ?? selectedId;
                const next = T.toggleCollapsed(tree, target);
                commit(next, {selectedId: safeSelection(next, selectedId)});
            },

            moveSelected: (delta) => {
                const {tree, selectedId} = get();
                commit(T.moveAmongSiblings(tree, selectedId, delta));
            },

            moveTopic: (id, parentId) => {
                const {tree} = get();
                if (!tree.nodes[id] || !tree.nodes[parentId] || tree.nodes[id].parentId === parentId) return;
                commit(T.moveNode(tree, id, parentId), {selectedId: id, editing: null});
            },

            moveTopics: (ids, parentId) => {
                const {tree} = get();
                if (!tree.nodes[parentId]) return;
                const chosen = new Set(ids.filter((id) => tree.nodes[id]));
                // Pre-order, so the moved topics keep the order they have in the map.
                const preorder: NodeId[] = [];
                const visit = (id: NodeId) => {
                    preorder.push(id);
                    tree.nodes[id].children.forEach(visit);
                };
                visit(tree.rootId);
                const top = preorder.filter(
                    (id) =>
                        chosen.has(id) &&
                        !T.pathTo(tree, id)
                            .slice(0, -1)
                            .some((a) => chosen.has(a)),
                );
                let next = tree;
                for (const id of top) {
                    if (next.nodes[id].parentId === parentId) continue;
                    next = T.moveNode(next, id, parentId);
                }
                commit(next, {editing: null});
            },

            undo: () => {
                const {past, future, tree, selectedId} = get();
                if (!past.length) return;
                const prev = past[past.length - 1];
                set({
                    tree: prev,
                    past: past.slice(0, -1),
                    future: [tree, ...future],
                    editing: null,
                    selectedId: safeSelection(prev, selectedId),
                });
            },

            redo: () => {
                const {past, future, tree, selectedId} = get();
                if (!future.length) return;
                const next = future[0];
                set({
                    tree: next,
                    past: [...past, tree],
                    future: future.slice(1),
                    editing: null,
                    selectedId: safeSelection(next, selectedId),
                });
            },

            setLayout: (layout) => set({layout}),

            setTree: (tree) => commit(tree, {selectedId: tree.rootId, editing: null}),

            applyRemote: (tree, ops) => {
                const {past, future, selectedId, editing} = get();
                const replay = (t: MindMapTree) => (t.rootId === tree.rootId ? applyOps(t, ops ?? []).tree : t);
                set({
                    tree,
                    past: ops ? past.map(replay) : [],
                    future: ops ? future.map(replay) : [],
                    selectedId: safeSelection(tree, selectedId),
                    editing: editing && tree.nodes[editing.id] ? editing : null,
                });
            },
        };
    });
}

export const MindMapStoreContext = createContext<MindMapStore | null>(null);

export function useMindMapStoreApi(): MindMapStore {
    const store = useContext(MindMapStoreContext);
    if (!store) throw new Error('MindMap components must be rendered inside <MindMap>');
    return store;
}

export function useMindMap<U>(selector: (s: MindMapState) => U): U {
    return useStore(useMindMapStoreApi(), selector);
}

/** Reads a store from outside `<MindMap>` (e.g. the app shell). */
export function useMindMapState<U>(store: MindMapStore, selector: (s: MindMapState) => U): U {
    return useStore(store, selector);
}
