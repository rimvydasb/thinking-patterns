import {useState} from 'react';
import {ICON_GROUPS} from '../model/icons';
import {useMindMapState, type MindMapStore} from '../store/mindmapStore';
import '../iconPanel.css';

const NO_ICONS: readonly string[] = [];

/** Keeps keyboard focus on the map so shortcuts keep working after a click. */
const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

/** Top-right button that opens and closes the icon panel. */
export function IconPanelButton({open, onToggle}: {open: boolean; onToggle(): void}) {
    return (
        <button
            type="button"
            className="ip-toggle"
            title={open ? 'Hide icons' : 'Icons'}
            aria-label={open ? 'Hide icons' : 'Icons'}
            aria-expanded={open}
            aria-controls="mm-icon-panel"
            data-testid="icon-panel-toggle"
            onMouseDown={preventFocusSteal}
            onClick={onToggle}
        >
            <span aria-hidden="true">😀</span>
        </button>
    );
}

/**
 * Right side panel with the topic icons, by group. Clicking an icon puts it in front of the selected topics: an icon
 * of a group the topic already has an icon of replaces that icon, an icon of another group is added, and an icon the
 * topic already has is removed again.
 */
export function IconPanel({store}: {store: MindMapStore}) {
    const active = useMindMapState(store, (s) => s.tree.nodes[s.selectedId]?.icons ?? NO_ICONS);
    const count = useMindMapState(store, (s) => s.selectedIds.length);
    const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

    const toggleGroup = (id: string) =>
        setFolded((f) => {
            const next = new Set(f);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <aside id="mm-icon-panel" className="ip-panel" aria-label="Icons" data-testid="icon-panel">
            <header className="ip-head">
                <h2 className="ip-title">Icons</h2>
                <span className="ip-hint">{count > 1 ? `${count} topics selected` : 'Selected topic'}</span>
            </header>
            <div className="ip-groups">
                {ICON_GROUPS.map((g) => {
                    const isFolded = folded.has(g.id);
                    return (
                        <section key={g.id} className="ip-group" data-testid={`icon-group-${g.id}`}>
                            <button
                                type="button"
                                className="ip-group__head"
                                aria-expanded={!isFolded}
                                onMouseDown={preventFocusSteal}
                                onClick={() => toggleGroup(g.id)}
                            >
                                <span className={`ip-caret${isFolded ? ' is-folded' : ''}`} aria-hidden="true">
                                    ▾
                                </span>
                                {g.label}
                            </button>
                            {!isFolded && (
                                <div className="ip-grid" role="group" aria-label={g.label}>
                                    {g.icons.map((icon) => {
                                        const on = active.includes(icon.code);
                                        return (
                                            <button
                                                key={icon.code}
                                                type="button"
                                                className={`ip-icon${on ? ' is-active' : ''}`}
                                                title={`:${icon.code}:`}
                                                aria-label={icon.code.replace(/_/g, ' ')}
                                                aria-pressed={on}
                                                data-testid={`icon-${icon.code}`}
                                                onMouseDown={preventFocusSteal}
                                                onClick={() => store.getState().pickIcon(icon.code)}
                                            >
                                                {icon.emoji}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
        </aside>
    );
}
