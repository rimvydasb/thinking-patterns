import type {BridgeStatus} from './useBridgeStatus';

const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

/** Top-right chip: is the AI server reachable, and which model generates topics. */
export function AiStatusChip({status, model, onClick}: {status: BridgeStatus; model: string; onClick(): void}) {
    const label =
        status.state === 'checking'
            ? 'AI: checking…'
            : status.state === 'connected'
              ? model.trim() || 'default model'
              : 'AI offline';
    const title =
        status.state === 'connected'
            ? `AI server connected (${status.ms} ms) · model ${model.trim() || 'server default'}`
            : status.state === 'offline'
              ? `AI server not connected: ${status.error ?? 'unknown error'}. Start it with: node bridge/server.mjs`
              : 'Checking the AI server…';
    return (
        <button
            type="button"
            className={`ai-chip ai-chip--${status.state}`}
            title={title}
            data-testid="ai-status"
            data-state={status.state}
            onMouseDown={preventFocusSteal}
            onClick={onClick}
        >
            <span className="ai-chip__dot" aria-hidden />
            {label}
        </button>
    );
}

export function SettingsButton({onClick}: {onClick(): void}) {
    return (
        <button
            type="button"
            className="ai-icon-btn"
            title="Settings"
            aria-label="Settings"
            data-testid="open-settings"
            onMouseDown={preventFocusSteal}
            onClick={onClick}
        >
            <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
            >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
        </button>
    );
}

/**
 * Indeterminate progress bar along the top of the window and a task label while topics are generated.
 * Shows the last error for a few seconds when generation failed.
 */
export function GenerationProgress({count, error}: {count: number; error: string | null}) {
    if (count === 0 && !error) return null;
    return (
        <>
            {count > 0 && <div className="ai-progress" role="progressbar" aria-label="Generating node" />}
            <div className={`ai-task${count === 0 ? ' ai-task--error' : ''}`} role="status" data-testid="ai-task">
                {count > 0 ? (
                    <>
                        <span className="ai-task__spinner" aria-hidden />
                        Generating node{count > 1 ? `s (${count})` : '…'}
                    </>
                ) : (
                    <>Generation failed: {error}</>
                )}
            </div>
        </>
    );
}
