import '@xyflow/react/dist/style.css';
import '../mindmap.css';
import {
    Background,
    BackgroundVariant,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type EdgeTypes,
    type NodeTypes,
    type OnNodeDrag,
} from '@xyflow/react';
import {useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode} from 'react';
import {computeLayout, withProvisionalNodes, type LayoutResult} from '../layout/elkLayout';
import {topicColors} from '../layout/theme';
import {branchIndex, fromOutline, getNode, hiddenDescendantCount, sideOf, subtreeIds} from '../model/tree';
import type {LayoutKind, MindMapTree, NodeId, Outline, Side} from '../model/types';
import {
    createMindMapStore,
    MindMapStoreContext,
    useMindMap,
    useMindMapStoreApi,
    type MindMapStore,
} from '../store/mindmapStore';
import {BranchEdge, type BranchEdgeType} from './BranchEdge';
import {ShortcutHelp, Toolbar} from './Toolbar';
import {TopicNode, type TopicNodeType} from './TopicNode';

const nodeTypes: NodeTypes = {topic: TopicNode};
const edgeTypes: EdgeTypes = {branch: BranchEdge};

const HANDLES: Record<Side, {sourceHandle: string; targetHandle: string}> = {
    right: {sourceHandle: 'out-right', targetHandle: 'in-left'},
    left: {sourceHandle: 'out-left', targetHandle: 'in-right'},
    down: {sourceHandle: 'out-bottom', targetHandle: 'in-top'},
};

export interface MindMapProps {
    /** Initial content (ignored when `store` is given). */
    initialTree?: MindMapTree | Outline;
    initialLayout?: LayoutKind;
    /** Bring your own store, e.g. to drive the map from outside. */
    store?: MindMapStore;
    showToolbar?: boolean;
    /** Extra controls at the end of the toolbar (the app puts the map file actions there). */
    toolbarExtra?: ReactNode;
    showHelp?: boolean;
    /**
     * Shift+Tab (`child`) and Shift+Enter (`sibling`) call this to add a topic whose name is generated (AI).
     * Without it, Shift+Enter adds an empty sibling before the selection and Shift+Tab does nothing.
     */
    onGenerateTopic?(where: 'child' | 'sibling'): void;
    autoFocus?: boolean;
    className?: string;
    style?: CSSProperties;
}

function toTree(t: MindMapTree | Outline | undefined): MindMapTree | undefined {
    if (!t) return undefined;
    return 'rootId' in t ? t : fromOutline(t);
}

/** Self-contained mind map editor: own store, React Flow provider, toolbar and shortcuts. */
export function MindMap({initialTree, initialLayout, store: external, ...rest}: MindMapProps) {
    const [store] = useState(() => external ?? createMindMapStore({tree: toTree(initialTree), layout: initialLayout}));
    return (
        <MindMapStoreContext.Provider value={store}>
            <ReactFlowProvider>
                <MindMapCanvas {...rest} />
            </ReactFlowProvider>
        </MindMapStoreContext.Provider>
    );
}

/** Topics being dragged onto another topic to re-parent them. */
interface DragState {
    /** The topic under the pointer. */
    id: NodeId;
    /** The topics to move: the dragged one, or the whole selection when the dragged topic is part of it. */
    ids: readonly NodeId[];
    /** The moved topics and their visible descendants; they move together and cannot be drop targets. */
    moving: ReadonlySet<NodeId>;
    dx: number;
    dy: number;
    /** Topic under the pointer that would become the new parent, if the drop is valid. */
    targetId: NodeId | null;
}

function pointerOf(e: MouseEvent | TouchEvent): {x: number; y: number} | null {
    if ('clientX' in e) return {x: e.clientX, y: e.clientY};
    const t = e.touches[0] ?? e.changedTouches[0];
    return t ? {x: t.clientX, y: t.clientY} : null;
}

function useAutoLayout(): {result: LayoutResult | null; version: number} {
    const tree = useMindMap((s) => s.tree);
    const layout = useMindMap((s) => s.layout);
    const [state, setState] = useState<{result: LayoutResult | null; version: number}>({result: null, version: 0});

    useEffect(() => {
        let cancelled = false;
        computeLayout(tree, layout)
            .then((result) => {
                if (!cancelled) setState((s) => ({result, version: s.version + 1}));
            })
            .catch((err) => console.error('[mindmap] layout failed', err));
        return () => {
            cancelled = true;
        };
    }, [tree, layout]);

    return state;
}

function MindMapCanvas({
    showToolbar = true,
    toolbarExtra,
    showHelp = true,
    onGenerateTopic,
    autoFocus = true,
    className,
    style,
}: Omit<MindMapProps, 'initialTree' | 'initialLayout' | 'store'>) {
    const store = useMindMapStoreApi();
    const tree = useMindMap((s) => s.tree);
    const layout = useMindMap((s) => s.layout);
    const selectedId = useMindMap((s) => s.selectedId);
    const selectedIds = useMindMap((s) => s.selectedIds);
    const editing = useMindMap((s) => s.editing);
    const generating = useMindMap((s) => s.generating);
    const {result: computed, version} = useAutoLayout();
    const result = useMemo(
        () => (computed ? withProvisionalNodes(computed, tree, layout) : null),
        [computed, tree, layout],
    );
    const rootRef = useRef<HTMLDivElement>(null);
    const flow = useReactFlow();
    const [drag, setDrag] = useState<DragState | null>(null);
    /** When a macOS Ctrl+click (context menu event) last toggled the selection, so a following click is ignored. */
    const ctrlMenuAt = useRef(0);

    const nodes = useMemo<TopicNodeType[]>(() => {
        if (!result) return [];
        return Object.values(result.nodes).map((p) => {
            const n = getNode(tree, p.id);
            const moving = !!drag?.moving.has(p.id);
            return {
                id: p.id,
                type: 'topic' as const,
                position: moving ? {x: p.x + drag!.dx, y: p.y + drag!.dy} : {x: p.x, y: p.y},
                width: p.width,
                height: p.height,
                // Sizes come from the layout; React Flow needs them to drag without onNodesChange.
                measured: {width: p.width, height: p.height},
                draggable: p.id !== tree.rootId && !editing,
                zIndex: moving ? 1000 : undefined,
                selectable: false,
                focusable: false,
                data: {
                    text: n.text,
                    depth: p.depth,
                    branch: branchIndex(tree, p.id),
                    side: p.side,
                    childSide: p.side ?? sideOf(tree, p.id, layout),
                    selected: selectedIds.includes(p.id),
                    primary: p.id === selectedId && selectedIds.length > 1,
                    editing: editing?.id === p.id,
                    editSeed: editing?.id === p.id ? editing.seed : null,
                    hiddenCount: hiddenDescendantCount(tree, p.id),
                    generating: !!generating[p.id],
                    dragging: moving,
                    dropTarget: drag?.targetId === p.id,
                },
            };
        });
    }, [result, tree, layout, selectedId, selectedIds, editing, generating, drag]);

    /**
     * The topic under the pointer that the dragged topics may be moved under: not one of them or their descendants,
     * and not a topic that already is the parent of all of them.
     */
    const dropTargetAt = (e: MouseEvent | TouchEvent, d: Pick<DragState, 'ids' | 'moving'>): NodeId | null => {
        const pointer = pointerOf(e);
        if (!result || !pointer) return null;
        const {x, y} = flow.screenToFlowPosition(pointer);
        const hit = Object.values(result.nodes).find(
            (p) => !d.moving.has(p.id) && x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height,
        );
        if (!hit || d.ids.every((id) => tree.nodes[id]?.parentId === hit.id)) return null;
        return hit.id;
    };

    const onNodeDragStart: OnNodeDrag<TopicNodeType> = (_, node) => {
        if (!result || !tree.nodes[node.id]) return;
        const group = selectedIds.length > 1 && selectedIds.includes(node.id);
        const ids = group ? selectedIds.filter((id) => id !== tree.rootId) : [node.id];
        const moving = new Set(ids.flatMap((id) => subtreeIds(tree, id)).filter((id) => result.nodes[id]));
        setDrag({id: node.id, ids, moving, dx: 0, dy: 0, targetId: null});
    };

    const onNodeDrag: OnNodeDrag<TopicNodeType> = (e, node) => {
        const origin = result?.nodes[node.id];
        if (!drag || drag.id !== node.id || !origin) return;
        setDrag({
            ...drag,
            dx: node.position.x - origin.x,
            dy: node.position.y - origin.y,
            targetId: dropTargetAt(e, drag),
        });
    };

    const onNodeDragStop: OnNodeDrag<TopicNodeType> = (e, node) => {
        const d = drag?.id === node.id ? drag : null;
        const targetId = d ? dropTargetAt(e, d) : null;
        setDrag(null);
        const s = store.getState();
        if (d && d.ids.length > 1) {
            // The selection stays as it is, so the group can be dragged again.
            if (targetId) s.moveTopics(d.ids, targetId);
        } else if (targetId) s.moveTopic(node.id, targetId);
        else s.select(node.id);
        rootRef.current?.focus({preventScroll: true});
    };

    const edges = useMemo<BranchEdgeType[]>(() => {
        if (!result) return [];
        return result.edges.map((e) => {
            const depth = result.nodes[e.source].depth;
            return {
                id: `${e.source}->${e.target}`,
                type: 'branch' as const,
                source: e.source,
                target: e.target,
                ...HANDLES[e.side],
                selectable: false,
                focusable: false,
                data: {
                    color: topicColors(depth + 1, branchIndex(tree, e.target)).line,
                    curved: depth === 0 && e.side !== 'down',
                    main: depth === 0,
                },
            };
        });
    }, [result, tree]);

    // Fit the whole map on the first layout and when switching layouts.
    const fittedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!result || fittedFor.current === layout) return;
        fittedFor.current = layout;
        requestAnimationFrame(() => void flow.fitView({padding: 0.15, maxZoom: 1.1}));
    }, [result, layout, flow]);

    // Keep the selected topic on screen.
    useEffect(() => {
        const p = result?.nodes[selectedId];
        const box = rootRef.current?.getBoundingClientRect();
        if (!p || !box) return;
        const {x: vx, y: vy, zoom} = flow.getViewport();
        const margin = 40;
        const left = p.x * zoom + vx;
        const top = p.y * zoom + vy;
        const right = left + p.width * zoom;
        const bottom = top + p.height * zoom;
        // Pan just enough to bring the topic inside the margin.
        const dx = left < margin ? margin - left : right > box.width - margin ? box.width - margin - right : 0;
        const dy = top < margin ? margin - top : bottom > box.height - margin ? box.height - margin - bottom : 0;
        if (dx || dy) void flow.setViewport({x: vx + dx, y: vy + dy, zoom}, {duration: 200});
    }, [selectedId, result, flow]);

    useEffect(() => {
        if (autoFocus) rootRef.current?.focus({preventScroll: true});
    }, [autoFocus]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const s = store.getState();
        if (s.editing) return; // the editor handles its own keys
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const mod = e.metaKey || e.ctrlKey;
        const horizontal = layout !== 'org';
        let handled = true;

        if (mod && e.key.toLowerCase() === 'z') {
            if (e.shiftKey) s.redo();
            else s.undo();
        } else if (mod && e.key.toLowerCase() === 'y') {
            s.redo();
        } else if (mod && e.key === '/') {
            s.toggleCollapse();
        } else if (mod && e.key === 'Enter') {
            s.addParent();
        } else if (e.altKey && e.key.startsWith('Arrow')) {
            const back = horizontal ? e.key === 'ArrowUp' : e.key === 'ArrowLeft';
            const fwd = horizontal ? e.key === 'ArrowDown' : e.key === 'ArrowRight';
            if (back) s.moveSelected(-1);
            else if (fwd) s.moveSelected(1);
            else handled = false;
        } else if (mod) {
            handled = false;
        } else {
            switch (e.key) {
                case 'Tab':
                    if (!e.shiftKey) s.addChild();
                    else if (onGenerateTopic) onGenerateTopic('child');
                    else handled = false;
                    break;
                case 'Enter':
                    if (!e.shiftKey) s.addSibling('after');
                    else if (onGenerateTopic) onGenerateTopic('sibling');
                    else s.addSibling('before');
                    break;
                case 'Delete':
                case 'Backspace':
                    s.deleteSelected();
                    break;
                case 'F2':
                case ' ':
                    s.startEditing();
                    break;
                case 'ArrowUp':
                case 'ArrowDown':
                case 'ArrowLeft':
                case 'ArrowRight':
                    s.navigate(e.key);
                    break;
                case 'Escape':
                    if (s.selectedIds.length > 1) s.select(s.selectedId);
                    else handled = false;
                    break;
                case 'Home':
                    s.select(s.tree.rootId);
                    break;
                default:
                    if (e.key.length === 1 && !e.altKey) s.startEditing(undefined, e.key);
                    else handled = false;
            }
        }
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    return (
        <div
            ref={rootRef}
            className={`mm-root${className ? ` ${className}` : ''}`}
            style={style}
            tabIndex={0}
            role="tree"
            aria-label="Mind map"
            data-testid="mindmap"
            data-layout={layout}
            data-layout-version={version}
            data-selected-id={selectedId}
            aria-multiselectable
            data-dragging={drag ? 'true' : undefined}
            onKeyDown={onKeyDown}
        >
            <ReactFlow<TopicNodeType, BranchEdgeType>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable
                nodeDragThreshold={4}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                nodesConnectable={false}
                nodesFocusable={false}
                elementsSelectable={false}
                edgesFocusable={false}
                disableKeyboardA11y
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                zoomOnDoubleClick={false}
                minZoom={0.1}
                maxZoom={2.5}
                proOptions={{hideAttribution: true}}
                onNodeClick={(e, node) => {
                    const s = store.getState();
                    if (e.metaKey || e.ctrlKey) {
                        // macOS turns Ctrl+click into a context menu event (handled below) and may not click.
                        if (Date.now() - ctrlMenuAt.current > 500) s.toggleSelect(node.id);
                    } else s.select(node.id);
                    if (!store.getState().editing) rootRef.current?.focus({preventScroll: true});
                }}
                onNodeContextMenu={(e, node) => {
                    // Ctrl+click on macOS: a primary-button context menu event.
                    if (!e.ctrlKey || e.button !== 0) return;
                    e.preventDefault();
                    ctrlMenuAt.current = Date.now();
                    store.getState().toggleSelect(node.id);
                    rootRef.current?.focus({preventScroll: true});
                }}
                onNodeDoubleClick={(_, node) => store.getState().startEditing(node.id)}
                onPaneClick={() => rootRef.current?.focus({preventScroll: true})}
            >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#d9dce3" />
                <Controls showInteractive={false} position="bottom-right" />
                {showToolbar && (
                    <Toolbar
                        onFit={() => void flow.fitView({padding: 0.15, maxZoom: 1.1, duration: 200})}
                        extra={toolbarExtra}
                    />
                )}
                {showHelp && <ShortcutHelp generate={!!onGenerateTopic} />}
            </ReactFlow>
        </div>
    );
}
