import {pathTo} from '../../app/mindmap/model/tree';
import type {MindMapTree, NodeId} from '../../app/mindmap/model/types';
import {MapError} from '../map/mapDocument';

/**
 * How an agent names a topic. Agents never see topic ids.
 * - `name`: the topic text. Works only while exactly one topic has that text.
 * - `path`: topic texts from an ancestor down to the topic, for example `["Product", "Risks"]`. The full path from
 *   the central topic always works; a shorter trailing part works while it is unique. `path` wins over `name`.
 */
export interface TopicRef {
    name?: string;
    path?: string[];
}

/** Argument names as the tool exposes them, so messages tell the agent exactly which argument to set. */
export interface RefArgNames {
    name: string;
    path: string;
}

export const TOPIC_ARGS: RefArgNames = {name: 'topicName', path: 'topicPath'};

/** Thrown when a name or path matches more than one topic. The message asks the agent to choose a path. */
export class AmbiguousTopicError extends MapError {}

/** Comparison form of topic text: case and whitespace do not matter. */
export function normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Topic texts from the central topic to the topic. Agents use this form in `topicPath`. */
export function topicPath(tree: MindMapTree, id: NodeId): string[] {
    return pathTo(tree, id).map((p) => tree.nodes[p].text);
}

const showPath = (path: string[]) => JSON.stringify(path);

function matchesPath(tree: MindMapTree, id: NodeId, path: string[]): boolean {
    const full = pathTo(tree, id);
    if (full.length < path.length) return false;
    const tail = full.slice(full.length - path.length);
    return tail.every((nid, i) => normalize(tree.nodes[nid].text) === normalize(path[i]));
}

function describe(ref: TopicRef, args: RefArgNames): string {
    return ref.path?.length ? `${args.path} ${showPath(ref.path)}` : `${args.name} "${ref.name}"`;
}

function candidates(tree: MindMapTree, ref: TopicRef, args: RefArgNames): NodeId[] {
    const ids = Object.keys(tree.nodes);
    if (ref.path?.length) return ids.filter((id) => matchesPath(tree, id, ref.path!));
    if (ref.name !== undefined && ref.name.trim()) {
        const want = normalize(ref.name);
        return ids.filter((id) => normalize(tree.nodes[id].text) === want);
    }
    throw new MapError(`Give "${args.name}" or "${args.path}".`);
}

function notFound(tree: MindMapTree, ref: TopicRef, args: RefArgNames): MapError {
    const last = ref.path?.length ? ref.path[ref.path.length - 1] : (ref.name ?? '');
    const word = normalize(last);
    const similar = Object.keys(tree.nodes)
        .filter((id) => word && normalize(tree.nodes[id].text).includes(word))
        .slice(0, 10)
        .map((id) => `- ${showPath(topicPath(tree, id))}`);
    const hint = similar.length
        ? `Topics with similar text:\n${similar.join('\n')}`
        : 'Use search_topics to find the topic.';
    return new MapError(`No topic matches ${describe(ref, args)}. ${hint}`);
}

function ambiguityQuestion(tree: MindMapTree, ref: TopicRef, ids: NodeId[], args: RefArgNames): string {
    const what = ref.path?.length
        ? `${args.path} ${showPath(ref.path)} matches ${ids.length} topics`
        : `${args.name} "${ref.name}" is not unique: ${ids.length} topics have this text`;
    const options = ids.map((id) => `- ${showPath(topicPath(tree, id))}`).join('\n');
    return `${what}. Which one do you mean? Nothing was changed. Call again with "${args.path}" set to one of:\n${options}`;
}

/** Resolves one topic. Throws `MapError` when nothing matches and `AmbiguousTopicError` when several do. */
export function resolveTopic(tree: MindMapTree, ref: TopicRef, args: RefArgNames = TOPIC_ARGS): NodeId {
    const ids = candidates(tree, ref, args);
    if (ids.length === 1) return ids[0];
    if (!ids.length) throw notFound(tree, ref, args);
    throw new AmbiguousTopicError(ambiguityQuestion(tree, ref, ids, args));
}

/** Resolves several topics; reports every unclear reference in one message, so the agent can fix all at once. */
export function resolveTopics(tree: MindMapTree, refs: readonly TopicRef[], args: RefArgNames = TOPIC_ARGS): NodeId[] {
    const ids: NodeId[] = [];
    const problems: string[] = [];
    let ambiguous = false;
    refs.forEach((ref, i) => {
        try {
            ids.push(resolveTopic(tree, ref, args));
        } catch (err) {
            if (!(err instanceof MapError)) throw err;
            ambiguous ||= err instanceof AmbiguousTopicError;
            problems.push(refs.length > 1 ? `Topic ${i + 1}: ${err.message}` : err.message);
        }
    });
    if (!problems.length) return ids;
    const message = problems.join('\n\n');
    throw ambiguous ? new AmbiguousTopicError(message) : new MapError(message);
}
