import {findByName, findByPath, normalize, shortestUniquePath, topicPath} from './topicPath';
import {fromOutline} from './tree';

const tree = fromOutline({
    text: 'Plan',
    children: [
        {text: 'Product', children: [{text: 'Risks'}, {text: 'Goals'}]},
        {text: 'Marketing', children: [{text: 'Risks'}, {text: 'Risks'}]},
    ],
});

describe('topicPath', () => {
    it('normalizes case and whitespace', () => {
        expect(normalize('  Big\n  Ideas ')).toBe('big ideas');
    });

    it('finds topics by name and by trailing path', () => {
        expect(findByName(tree, 'risks')).toHaveLength(3);
        expect(findByPath(tree, ['product', ' RISKS '])).toEqual(['root.0.0']);
        expect(findByPath(tree, ['Plan', 'Product', 'Risks'])).toEqual(['root.0.0']);
        expect(topicPath(tree, 'root.0.1')).toEqual(['Plan', 'Product', 'Goals']);
    });

    it('returns the shortest unique trailing path, or the full path for same-text siblings', () => {
        expect(shortestUniquePath(tree, 'root.0.1')).toEqual(['Goals']);
        expect(shortestUniquePath(tree, 'root.0.0')).toEqual(['Product', 'Risks']);
        expect(shortestUniquePath(tree, 'root.1.1')).toEqual(['Plan', 'Marketing', 'Risks']);
        expect(shortestUniquePath(tree, 'root')).toEqual(['Plan']);
    });
});
