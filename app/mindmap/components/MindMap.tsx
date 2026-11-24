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
} from '@xyflow/react';
import {useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent} from 'react';
import {computeLayout, withProvisionalNodes, type LayoutResult} from '../layout/elkLayout';
import {topicColors} from '../layout/theme';
import {branchIndex, fromOutline, getNode, hiddenDescendantCount, sideOf} from '../model/tree';
import type {LayoutKind, MindMapTree, Outline, Side} from '../model/types';
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
    showHelp?: boolean;
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
    showHelp = true,
    autoFocus = true,
    className,
    style,
}: Omit<MindMapProps, 'initialTree' | 'initialLayout' | 'store'>) {
    const store = useMindMapStoreApi();
    const tree = useMindMap((s) => s.tree);
    const layout = useMindMap((s) => s.layout);
    const selectedId = useMindMap((s) => s.selectedId);
    const editing = useMindMap((s) => s.editing);
    const {result: computed, version} = useAutoLayout();
    const result = useMemo(
        () => (computed ? withProvisionalNodes(computed, tree, layout) : null),
        [computed, tree, layout],
    );
    const rootRef = useRef<HTMLDivElement>(null);
    const flow = useReactFlow();

    const nodes = useMemo<TopicNodeType[]>(() => {
        if (!result) return [];
        return Object.values(result.nodes).map((p) => {
            const n = getNode(tree, p.id);
            return {
                id: p.id,
                type: 'topic' as const,
                position: {x: p.x, y: p.y},
                width: p.width,
                height: p.height,
                draggable: false,
                selectable: false,
                focusable: false,
                data: {
                    text: n.text,
                    depth: p.depth,
                    branch: branchIndex(tree, p.id),
                    side: p.side,
                    childSide: p.side ?? sideOf(tree, p.id, layout),
                    selected: p.id === selectedId,
                    editing: editing?.id === p.id,
                    editSeed: editing?.id === p.id ? editing.seed : null,
                    hiddenCount: hiddenDescendantCount(tree, p.id),
                },
            };
        });
    }, [result, tree, layout, selectedId, editing]);

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
                    if (e.shiftKey) handled = false;
                    else s.addChild();
                    break;
                case 'Enter':
                    s.addSibling(e.shiftKey ? 'before' : 'after');
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
            onKeyDown={onKeyDown}
        >
            <ReactFlow<TopicNodeType, BranchEdgeType>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={false}
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
                onNodeClick={(_, node) => {
                    store.getState().select(node.id);
                    if (!store.getState().editing) rootRef.current?.focus({preventScroll: true});
                }}
                onNodeDoubleClick={(_, node) => store.getState().startEditing(node.id)}
                onPaneClick={() => rootRef.current?.focus({preventScroll: true})}
            >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#d9dce3" />
                <Controls showInteractive={false} position="bottom-right" />
                {showToolbar && (
                    <Toolbar onFit={() => void flow.fitView({padding: 0.15, maxZoom: 1.1, duration: 200})} />
                )}
                {showHelp && <ShortcutHelp />}
            </ReactFlow>
        </div>
    );
}
