import {Panel} from '@xyflow/react';
import {useState, type ReactNode} from 'react';
import type {LayoutKind} from '../model/types';
import {useMindMap, useMindMapStoreApi} from '../store/mindmapStore';

const LAYOUTS: {kind: LayoutKind; label: string}[] = [
    {kind: 'mindmap', label: 'Mind Map'},
    {kind: 'logic', label: 'Logic Chart'},
    {kind: 'org', label: 'Org Chart'},
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

function ToolButton({
    label,
    title,
    onClick,
    disabled,
    pressed,
    testId,
}: {
    label: ReactNode;
    title: string;
    onClick(): void;
    disabled?: boolean;
    pressed?: boolean;
    testId?: string;
}) {
    return (
        <button
            type="button"
            className="mm-btn"
            title={title}
            aria-label={title}
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={testId}
            // Keep keyboard focus on the map so shortcuts keep working after a click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

export function Toolbar({onFit, extra}: {onFit(): void; extra?: ReactNode}) {
    const store = useMindMapStoreApi();
    const layout = useMindMap((s) => s.layout);
    const canUndo = useMindMap((s) => s.past.length > 0);
    const canRedo = useMindMap((s) => s.future.length > 0);
    const isRoot = useMindMap((s) => s.selectedId === s.tree.rootId);
    const act = (fn: () => void) => () => fn();

    return (
        <Panel position="top-left" className="mm-toolbar" aria-label="Mind map toolbar">
            <div className="mm-group" role="group" aria-label="Layout">
                {LAYOUTS.map((l) => (
                    <ToolButton
                        key={l.kind}
                        label={l.label}
                        title={`${l.label} layout`}
                        pressed={layout === l.kind}
                        testId={`layout-${l.kind}`}
                        onClick={act(() => store.getState().setLayout(l.kind))}
                    />
                ))}
            </div>
            <div className="mm-group" role="group" aria-label="Edit">
                <ToolButton
                    label="+ Child"
                    title="Add child topic (Tab)"
                    testId="add-child"
                    onClick={act(() => store.getState().addChild())}
                />
                <ToolButton
                    label="+ Sibling"
                    title="Add sibling topic (Enter)"
                    testId="add-sibling"
                    onClick={act(() => store.getState().addSibling())}
                />
                <ToolButton
                    label="Delete"
                    title="Delete topic (Delete)"
                    testId="delete"
                    disabled={isRoot}
                    onClick={act(() => store.getState().deleteSelected())}
                />
                <ToolButton
                    label="Collapse"
                    title={`Collapse / expand (${MOD}+/)`}
                    testId="toggle-collapse"
                    onClick={act(() => store.getState().toggleCollapse())}
                />
            </div>
            <div className="mm-group" role="group" aria-label="History">
                <ToolButton
                    label="↶"
                    title={`Undo (${MOD}+Z)`}
                    testId="undo"
                    disabled={!canUndo}
                    onClick={act(() => store.getState().undo())}
                />
                <ToolButton
                    label="↷"
                    title={`Redo (${MOD}+Shift+Z)`}
                    testId="redo"
                    disabled={!canRedo}
                    onClick={act(() => store.getState().redo())}
                />
                <ToolButton label="Fit" title="Fit map to screen" testId="fit" onClick={onFit} />
            </div>
            {extra}
        </Panel>
    );
}

const shortcuts = (generate: boolean): [string, string][] => [
    ['Tab', 'Add child'],
    ['Enter', 'Add sibling after'],
    ...(generate
        ? ([
              ['Shift+Tab', 'Generate child (AI; a list if none yet)'],
              ['Shift+Enter', 'Generate sibling (AI)'],
          ] as [string, string][])
        : ([['Shift+Enter', 'Add sibling before']] as [string, string][])),
    [`${MOD}+Enter`, 'Insert parent'],
    ['Delete / ⌫', 'Delete topic'],
    ['F2 / Space / type', 'Edit text'],
    ['Arrows', 'Move selection'],
    ['Alt+Arrows', 'Reorder siblings'],
    [`${MOD}+/`, 'Collapse / expand'],
    [`${MOD}+Z / ${MOD}+Shift+Z`, 'Undo / redo'],
    ['Esc', 'Cancel editing'],
];

export function ShortcutHelp({generate = false}: {generate?: boolean}) {
    const [open, setOpen] = useState(false);
    return (
        <Panel position="bottom-left" className="mm-help">
            {open && (
                <dl className="mm-help__list" data-testid="shortcut-help">
                    {shortcuts(generate).map(([k, v]) => (
                        <div key={k}>
                            <dt>
                                <kbd>{k}</kbd>
                            </dt>
                            <dd>{v}</dd>
                        </div>
                    ))}
                </dl>
            )}
            <ToolButton
                label={open ? 'Hide shortcuts' : 'Shortcuts'}
                title="Keyboard shortcuts"
                onClick={() => setOpen((o) => !o)}
            />
        </Panel>
    );
}
