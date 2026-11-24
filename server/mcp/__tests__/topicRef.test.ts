import {fromOutline} from '../../../app/mindmap/model/tree';
import {MapError} from '../../map/mapDocument';
import {AmbiguousTopicError, resolveTopic, resolveTopics} from '../topicRef';

const tree = fromOutline({
    text: 'Plan',
    children: [
        {text: 'Product', children: [{text: 'Risks', children: [{text: 'Scope creep'}]}, {text: 'Goals'}]},
        {text: 'Marketing', children: [{text: 'Risks'}]},
        {text: 'Budget'},
    ],
});

describe('resolveTopic', () => {
    it('finds a unique name, ignoring case and whitespace', () => {
        expect(resolveTopic(tree, {name: '  budget '})).toBe('root.2');
        expect(resolveTopic(tree, {name: 'Plan'})).toBe('root');
    });

    it('asks which topic is meant when a name is not unique, listing all paths', () => {
        let error: unknown;
        try {
            resolveTopic(tree, {name: 'Risks'});
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(AmbiguousTopicError);
        expect((error as Error).message).toBe(
            'topicName "Risks" is not unique: 2 topics have this text. Which one do you mean? Nothing was changed. ' +
                'Call again with "topicPath" set to one of:\n' +
                '- ["Plan","Product","Risks"]\n' +
                '- ["Plan","Marketing","Risks"]',
        );
    });

    it('resolves full paths and unique trailing paths', () => {
        expect(resolveTopic(tree, {path: ['Plan', 'Marketing', 'Risks']})).toBe('root.1.0');
        expect(resolveTopic(tree, {path: ['Product', 'Risks']})).toBe('root.0.0');
        expect(resolveTopic(tree, {path: ['Scope creep']})).toBe('root.0.0.0');
        expect(resolveTopic(tree, {name: 'Risks', path: ['Marketing', 'Risks']})).toBe('root.1.0');
        expect(() => resolveTopic(tree, {path: ['Risks']})).toThrow(AmbiguousTopicError);
    });

    it('suggests similar topics when nothing matches', () => {
        expect(() => resolveTopic(tree, {name: 'Risk'})).toThrow(
            'No topic matches topicName "Risk". Topics with similar text:\n- ["Plan","Product","Risks"]\n- ["Plan","Marketing","Risks"]',
        );
        expect(() => resolveTopic(tree, {path: ['Budget', 'Risks']})).toThrow(MapError);
        expect(() => resolveTopic(tree, {name: 'Unknown'})).toThrow(/search_topics/);
        expect(() => resolveTopic(tree, {})).toThrow('Give "topicName" or "topicPath".');
    });

    it('uses the argument names of the tool in messages', () => {
        expect(() => resolveTopic(tree, {name: 'Risks'}, {name: 'parentName', path: 'parentPath'})).toThrow(
            /parentName "Risks" is not unique.*"parentPath"/s,
        );
    });
});

describe('resolveTopics', () => {
    it('reports all unclear references at once', () => {
        expect(() => resolveTopics(tree, [{name: 'Budget'}, {name: 'Risks'}, {name: 'Nope'}])).toThrow(
            /Topic 2: topicName "Risks" is not unique[\s\S]*Topic 3: No topic matches/,
        );
        expect(resolveTopics(tree, [{name: 'Budget'}, {path: ['Marketing', 'Risks']}])).toEqual(['root.2', 'root.1.0']);
    });
});
