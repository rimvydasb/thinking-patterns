/** Minimal client for an OpenAI-compatible server such as the Claude bridge (`bridge/server.mjs`). */

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface PingResult {
    ok: boolean;
    /** Round trip in milliseconds (when `ok`). */
    ms?: number;
    error?: string;
}

function base(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

function describe(error: unknown): string {
    if (error instanceof DOMException && error.name === 'TimeoutError') return 'timed out';
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    if (error instanceof TypeError) return 'not reachable';
    return error instanceof Error ? error.message : String(error);
}

/** Checks `GET /health` of the bridge. */
export async function ping(url: string, timeoutMs = 3000): Promise<PingResult> {
    const start = performance.now();
    try {
        const res = await fetch(`${base(url)}/health`, {signal: AbortSignal.timeout(timeoutMs)});
        if (!res.ok) return {ok: false, error: `HTTP ${res.status}`};
        return {ok: true, ms: Math.round(performance.now() - start)};
    } catch (error) {
        return {ok: false, error: describe(error)};
    }
}

/** Lists the model ids the server offers (`GET /v1/models`). */
export async function listModels(url: string, timeoutMs = 5000): Promise<string[]> {
    const res = await fetch(`${base(url)}/v1/models`, {signal: AbortSignal.timeout(timeoutMs)});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {data?: {id?: unknown}[]};
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
}

/** Sends one chat completion and returns the answer text. */
export async function complete(opts: {
    url: string;
    model: string;
    messages: ChatMessage[];
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<string> {
    const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];
    let res: Response;
    try {
        res = await fetch(`${base(opts.url)}/v1/chat/completions`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({...(opts.model.trim() ? {model: opts.model.trim()} : {}), messages: opts.messages}),
            signal: AbortSignal.any(signals),
        });
    } catch (error) {
        throw new Error(`AI server ${describe(error)}`);
    }
    const body = (await res.json().catch(() => null)) as {
        choices?: {message?: {content?: unknown}}[];
        error?: {message?: string};
    } | null;
    if (!res.ok) throw new Error(body?.error?.message ?? `AI server answered HTTP ${res.status}`);
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('AI server sent no answer text');
    return text;
}
