import {createContext, useContext} from 'react';
import {createStore, useStore, type StoreApi} from 'zustand';
import {applyOps, type MapOp} from '../model/ops';
import * as T from '../model/tree';
import type {ArrowKey} from '../model/tree';
import type {LayoutKind, MindMapTree, NodeId} from '../model/types';

const HISTORY_LIMIT = 200;

export interface EditingState {
    id: NodeId;
    /** Text to start with (typing on a selected topic replaces its text). `null` = current text, all selected. */
    seed: string | null;
}

export interface MindMapState {
    tree: MindMapTree;
    layout: LayoutKind;
    selectedId: NodeId;
    editing: EditingState | null;
    past: MindMapTree[];
    future: MindMapTree[];

    select(id: NodeId): void;
    navigate(key: ArrowKey): void;
    startEditing(id?: NodeId, seed?: string | null): void;
    commitEdit(text: string): void;
    cancelEdit(): void;
    addChild(): void;
    addSibling(position?: 'before' | 'after'): void;
    addParent(): void;
    deleteSelected(): void;
    toggleCollapse(id?: NodeId): void;
    moveSelected(delta: number): void;
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
    return createStore<MindMapState>()((set, get) => {
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
            editing: null,
            past: [],
            future: [],

            select: (id) => {
                if (get().tree.nodes[id]) set({selectedId: id});
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
