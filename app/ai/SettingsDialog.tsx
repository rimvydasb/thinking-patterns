import {useEffect, useRef, useState} from 'react';
import {listModels} from './bridgeApi';
import {
    DEFAULT_TOPIC_LIST_PROMPT,
    DEFAULT_TOPIC_PROMPT,
    MAX_LIST_TOPICS,
    TIMEOUT_CHOICES,
    type AiSettings,
} from './settings';
import {useBridgeStatus} from './useBridgeStatus';

type Section = 'server' | 'prompts';

const SECTIONS: {id: Section; label: string; icon: React.ReactNode}[] = [
    {
        id: 'server',
        label: 'AI server',
        icon: (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="7" rx="2" />
                <rect x="3" y="13" width="18" height="7" rx="2" />
                <path d="M7 7.5h.01M7 16.5h.01" strokeLinecap="round" strokeWidth="2.4" />
            </svg>
        ),
    },
    {
        id: 'prompts',
        label: 'Prompts',
        icon: (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" strokeLinejoin="round" />
                <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" strokeLinejoin="round" />
            </svg>
        ),
    },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function PromptField(props: {
    id: string;
    label: string;
    hint: string;
    value: string;
    fallback: string;
    onChange(value: string): void;
}) {
    return (
        <div className="st-field">
            <label htmlFor={props.id}>{props.label}</label>
            <p className="st-hint">{props.hint}</p>
            <textarea id={props.id} rows={6} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
            <div>
                <button
                    type="button"
                    className="st-btn st-btn--small"
                    disabled={props.value === props.fallback}
                    onClick={() => props.onChange(props.fallback)}
                >
                    Reset to default
                </button>
            </div>
        </div>
    );
}

function same(a: AiSettings, b: AiSettings): boolean {
    return (
        a.serverUrl === b.serverUrl &&
        a.model === b.model &&
        a.timeoutSec === b.timeoutSec &&
        a.topicPrompt === b.topicPrompt &&
        a.topicListPrompt === b.topicListPrompt
    );
}

export function SettingsDialog({
    settings,
    onSave,
    onClose,
}: {
    settings: AiSettings;
    onSave(settings: AiSettings): void;
    onClose(): void;
}) {
    const [draft, setDraft] = useState(settings);
    const [section, setSection] = useState<Section>('server');
    const [models, setModels] = useState<string[] | null>(null);
    const [listing, setListing] = useState<{busy: boolean; error?: string}>({busy: false});
    const {status} = useBridgeStatus(draft.serverUrl);
    const dialogRef = useRef<HTMLDivElement>(null);
    const dirty = !same(draft, settings);
    const patch = (p: Partial<AiSettings>) => setDraft((d) => ({...d, ...p}));

    const testAndList = async () => {
        setListing({busy: true});
        try {
            setModels(await listModels(draft.serverUrl));
            setListing({busy: false});
        } catch (error) {
            setModels(null);
            setListing({busy: false, error: error instanceof Error ? error.message : String(error)});
        }
    };

    // List the models once when the dialog opens.
    useEffect(() => {
        void testAndList();
        dialogRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const save = () => {
        if (!dirty) return;
        onSave({...draft, serverUrl: draft.serverUrl.trim(), model: draft.model.trim()});
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            save();
        }
    };

    const modelChoices = models ?? ['haiku', 'sonnet', 'opus'];

    return (
        <div className="st-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div
                ref={dialogRef}
                className="st-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="st-title"
                tabIndex={-1}
                data-testid="settings-dialog"
                onKeyDown={onKeyDown}
            >
                <header className="st-header">
                    <h2 id="st-title">Settings</h2>
                    <button type="button" className="st-close" aria-label="Close settings" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2">
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                        </svg>
                    </button>
                </header>

                <div className="st-body">
                    <nav className="st-nav" aria-label="Settings sections">
                        {SECTIONS.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                className="st-nav__item"
                                aria-current={section === s.id ? 'page' : undefined}
                                onClick={() => setSection(s.id)}
                            >
                                {s.icon}
                                {s.label}
                            </button>
                        ))}
                    </nav>

                    <div className="st-content">
                        {section === 'server' ? (
                            <section>
                                <h3>AI server</h3>
                                <p className="st-lead">
                                    Generated topic names (Shift+Tab, Shift+Enter) come from an OpenAI-compatible
                                    server, for example the Claude bridge. Only the topics around the new one are sent.
                                </p>

                                <div className="st-field">
                                    <label htmlFor="st-url">Server address</label>
                                    <p className="st-hint">
                                        Claude bridge: <code>node bridge/server.mjs</code>
                                    </p>
                                    <div className="st-input">
                                        <input
                                            id="st-url"
                                            className="st-mono"
                                            value={draft.serverUrl}
                                            spellCheck={false}
                                            data-testid="settings-url"
                                            onChange={(e) => patch({serverUrl: e.target.value})}
                                        />
                                        <span
                                            className={`st-conn st-conn--${status.state}`}
                                            data-testid="settings-connection"
                                        >
                                            <span className="ai-chip__dot" aria-hidden />
                                            {status.state === 'checking'
                                                ? 'checking…'
                                                : status.state === 'connected'
                                                  ? `connected · ${status.ms} ms`
                                                  : (status.error ?? 'not connected')}
                                        </span>
                                    </div>
                                </div>

                                <div className="st-field">
                                    <label htmlFor="st-model">Model</label>
                                    <p className="st-hint">
                                        Empty = the server's default model. Click one to choose it.
                                    </p>
                                    <div className="st-input">
                                        <input
                                            id="st-model"
                                            className="st-mono"
                                            value={draft.model}
                                            spellCheck={false}
                                            data-testid="settings-model"
                                            onChange={(e) => patch({model: e.target.value})}
                                        />
                                        <button
                                            type="button"
                                            className="st-btn st-btn--small"
                                            disabled={listing.busy}
                                            onClick={() => void testAndList()}
                                        >
                                            {listing.busy ? 'Testing…' : 'Test & list'}
                                        </button>
                                    </div>
                                    <div className="st-chips">
                                        {modelChoices.map((m) => (
                                            <button
                                                key={m}
                                                type="button"
                                                className="st-chip"
                                                aria-pressed={draft.model === m}
                                                onClick={() => patch({model: m})}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                    {listing.error && <p className="st-error">Cannot list models: {listing.error}</p>}
                                </div>

                                <div className="st-field">
                                    <span className="st-label">Request timeout</span>
                                    <p className="st-hint">How long to wait for one generated topic.</p>
                                    <div className="st-segments" role="group" aria-label="Request timeout">
                                        {TIMEOUT_CHOICES.map((c) => (
                                            <button
                                                key={c.sec}
                                                type="button"
                                                aria-pressed={draft.timeoutSec === c.sec}
                                                onClick={() => patch({timeoutSec: c.sec})}
                                            >
                                                {c.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        ) : (
                            <section>
                                <h3>Prompts</h3>
                                <p className="st-lead">
                                    The instructions sent with every topic request. The request itself lists the path to
                                    the parent topic and the topics already next to the new one.
                                </p>
                                <PromptField
                                    id="st-prompt"
                                    label="One topic"
                                    hint="Shift+Enter, and Shift+Tab on a topic that already has subtopics."
                                    value={draft.topicPrompt}
                                    fallback={DEFAULT_TOPIC_PROMPT}
                                    onChange={(topicPrompt) => patch({topicPrompt})}
                                />
                                <PromptField
                                    id="st-list-prompt"
                                    label="First subtopics (list)"
                                    hint={`Shift+Tab on a topic without subtopics: up to ${MAX_LIST_TOPICS} at once.`}
                                    value={draft.topicListPrompt}
                                    fallback={DEFAULT_TOPIC_LIST_PROMPT}
                                    onChange={(topicListPrompt) => patch({topicListPrompt})}
                                />
                            </section>
                        )}
                    </div>
                </div>

                <footer className="st-footer">
                    <span className="st-footer__state">{dirty ? 'Unsaved changes.' : 'No changes.'}</span>
                    <button type="button" className="st-btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="st-btn st-btn--primary"
                        disabled={!dirty || !draft.topicPrompt.trim() || !draft.topicListPrompt.trim()}
                        data-testid="settings-save"
                        onClick={save}
                    >
                        Save <kbd>{isMac ? '⌘S' : 'Ctrl+S'}</kbd>
                    </button>
                </footer>
            </div>
        </div>
    );
}
