/** Settings of the AI server (the Claude bridge or any OpenAI-compatible server). Kept in localStorage. */
export interface AiSettings {
    /** Base address, e.g. `http://127.0.0.1:3456`. */
    serverUrl: string;
    /** Model id; empty = the server's default. */
    model: string;
    /** Seconds to wait for one answer. */
    timeoutSec: number;
    /** System prompt for generating one topic. */
    topicPrompt: string;
    /** System prompt for generating the first children of a topic (a list). */
    topicListPrompt: string;
}

export const DEFAULT_TOPIC_PROMPT =
    'You help someone brainstorm a mind map. Reply with exactly one new topic name and nothing else: ' +
    'short (1 to 5 words), no quotes, no numbering, no explanation. ' +
    'Match the existing topics under the same parent: the same kind of thing, the same level of detail, ' +
    'the same language and style (if they are single items such as "Apple", give another single item, ' +
    'not a group or category). Never repeat a topic that already exists.';

/** Most topics one list request may add. */
export const MAX_LIST_TOPICS = 10;

export const DEFAULT_TOPIC_LIST_PROMPT =
    'You help someone brainstorm a mind map. Reply with a list of new subtopics and nothing else: ' +
    `one per line, at most ${MAX_LIST_TOPICS}, each short (1 to 5 words), no quotes, no numbering, no explanation. ` +
    'Give only as many as make sense: a closed set (such as the days of the week or primary colours) gets exactly ' +
    'its members, an open one gets the most typical or useful ones. All items must be the same kind of thing at ' +
    'the same level of detail, in the language and style of the map.';

export const DEFAULT_AI_SETTINGS: AiSettings = {
    serverUrl: 'http://127.0.0.1:3456',
    model: 'haiku',
    timeoutSec: 60,
    topicPrompt: DEFAULT_TOPIC_PROMPT,
    topicListPrompt: DEFAULT_TOPIC_LIST_PROMPT,
};

export const TIMEOUT_CHOICES = [
    {sec: 30, label: '30 s'},
    {sec: 60, label: '1 min'},
    {sec: 180, label: '3 min'},
];

const KEY = 'thinking-patterns.ai-settings';

export function loadAiSettings(): AiSettings {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return DEFAULT_AI_SETTINGS;
        const saved = JSON.parse(raw) as Partial<AiSettings>;
        return {
            serverUrl: typeof saved.serverUrl === 'string' ? saved.serverUrl : DEFAULT_AI_SETTINGS.serverUrl,
            model: typeof saved.model === 'string' ? saved.model : DEFAULT_AI_SETTINGS.model,
            timeoutSec:
                typeof saved.timeoutSec === 'number' && saved.timeoutSec > 0
                    ? saved.timeoutSec
                    : DEFAULT_AI_SETTINGS.timeoutSec,
            topicPrompt:
                typeof saved.topicPrompt === 'string' && saved.topicPrompt.trim()
                    ? saved.topicPrompt
                    : DEFAULT_AI_SETTINGS.topicPrompt,
            topicListPrompt:
                typeof saved.topicListPrompt === 'string' && saved.topicListPrompt.trim()
                    ? saved.topicListPrompt
                    : DEFAULT_AI_SETTINGS.topicListPrompt,
        };
    } catch {
        return DEFAULT_AI_SETTINGS;
    }
}

export function saveAiSettings(settings: AiSettings): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
        // Private mode or blocked storage: the settings last for this session only.
    }
}
