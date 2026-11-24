import {Handle, Position, type Node, type NodeProps} from '@xyflow/react';
import {memo, useEffect, useLayoutEffect, useRef} from 'react';
import type {Side} from '../model/types';
import {FONT_FAMILY, topicColors, topicStyle} from '../layout/theme';
import {useMindMapStoreApi} from '../store/mindmapStore';

export type TopicNodeData = {
    text: string;
    depth: number;
    branch: number;
    /** Direction of this node relative to its parent. */
    side: Side | null;
    /** Direction its children grow (for the collapse badge). */
    childSide: Side;
    selected: boolean;
    editing: boolean;
    editSeed: string | null;
    hiddenCount: number;
};

export type TopicNodeType = Node<TopicNodeData, 'topic'>;

const BADGE_POSITION: Record<Side, React.CSSProperties> = {
    right: {right: -22, top: '50%', transform: 'translateY(-50%)'},
    left: {left: -22, top: '50%', transform: 'translateY(-50%)'},
    down: {bottom: -22, left: '50%', transform: 'translateX(-50%)'},
};

function TopicEditor({
    initial,
    seeded,
    style,
    onCommit,
    onCancel,
    onTab,
}: {
    initial: string;
    seeded: boolean;
    style: React.CSSProperties;
    onCommit(text: string): void;
    onCancel(): void;
    onTab(text: string): void;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const done = useRef(false);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.focus({preventScroll: true});
        if (seeded) el.setSelectionRange(el.value.length, el.value.length);
        else el.select();
    }, [seeded]);

    const autosize = () => {
        const el = ref.current;
        if (!el) return;
        el.style.height = '0px';
        el.style.height = `${el.scrollHeight}px`;
    };
    useEffect(autosize, []);

    const finish = (fn: () => void) => {
        if (done.current) return;
        done.current = true;
        fn();
    };

    return (
        <textarea
            ref={ref}
            className="mm-topic__editor nodrag nopan nowheel"
            aria-label="Topic text"
            data-testid="topic-editor"
            defaultValue={initial}
            rows={1}
            style={style}
            onInput={autosize}
            onBlur={(e) => finish(() => onCommit(e.currentTarget.value))}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    finish(() => onCommit(e.currentTarget.value));
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(onCancel);
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    finish(() => onTab(e.currentTarget.value));
                }
            }}
        />
    );
}

function TopicNodeComponent({id, data, width, height}: NodeProps<TopicNodeType>) {
    const store = useMindMapStoreApi();
    const s = topicStyle(data.depth);
    const colors = topicColors(data.depth, data.branch);

    const textStyle: React.CSSProperties = {
        fontFamily: FONT_FAMILY,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: colors.text,
    };

    const boxRef = useRef<HTMLDivElement>(null);
    /** Gives keyboard control back to the map container after editing. */
    const refocusCanvas = () => {
        boxRef.current?.closest<HTMLElement>('.mm-root')?.focus({preventScroll: true});
    };

    return (
        <div
            ref={boxRef}
            className={`mm-topic mm-topic--d${Math.min(data.depth, 3)}${data.selected ? ' is-selected' : ''}${data.editing ? ' is-editing' : ''}`}
            data-testid="topic"
            data-topic-id={id}
            data-depth={data.depth}
            data-side={data.side ?? 'root'}
            aria-selected={data.selected}
            role="treeitem"
            style={{
                ...textStyle,
                // While editing, the box grows with the text (up to the wrap width).
                width: data.editing ? 'max-content' : width,
                maxWidth: data.editing ? s.maxTextWidth + s.padX * 2 + 4 : undefined,
                // Topics on the left of the map grow leftwards, away from their parent.
                ...(data.editing && data.side === 'left' ? {position: 'absolute', right: 0, top: 0} : {}),
                minWidth: width,
                minHeight: height,
                padding: `${s.padY}px ${s.padX}px`,
                borderRadius: data.depth >= 3 ? 0 : s.radius,
                background: colors.background,
                // Depth 3+ topics are plain text with an underline in the branch colour.
                borderBottom: data.depth >= 3 ? `2px solid ${colors.line}` : undefined,
                ['--mm-accent' as string]: colors.line,
            }}
        >
            <Handle type="target" position={Position.Left} id="in-left" />
            <Handle type="target" position={Position.Right} id="in-right" />
            <Handle type="target" position={Position.Top} id="in-top" />
            <Handle type="source" position={Position.Right} id="out-right" />
            <Handle type="source" position={Position.Left} id="out-left" />
            <Handle type="source" position={Position.Bottom} id="out-bottom" />

            {data.editing ? (
                <TopicEditor
                    initial={data.editSeed ?? data.text}
                    seeded={data.editSeed !== null}
                    style={{
                        ...textStyle,
                        minWidth: Math.max(40, (width ?? 0) - s.padX * 2 - 4),
                        maxWidth: s.maxTextWidth + 4,
                    }}
                    onCommit={(text) => {
                        refocusCanvas();
                        store.getState().commitEdit(text);
                    }}
                    onCancel={() => {
                        refocusCanvas();
                        store.getState().cancelEdit();
                    }}
                    onTab={(text) => {
                        store.getState().commitEdit(text);
                        store.getState().addChild();
                    }}
                />
            ) : (
                <span className="mm-topic__text" data-testid="topic-text">
                    {data.text}
                </span>
            )}

            {data.hiddenCount > 0 && (
                <button
                    type="button"
                    className="mm-topic__badge nodrag nopan"
                    data-testid="collapse-badge"
                    title="Expand"
                    style={{...BADGE_POSITION[data.childSide], borderColor: colors.line, color: colors.line}}
                    onClick={(e) => {
                        e.stopPropagation();
                        store.getState().toggleCollapse(id);
                    }}
                >
                    {data.hiddenCount}
                </button>
            )}
        </div>
    );
}

export const TopicNode = memo(TopicNodeComponent);
