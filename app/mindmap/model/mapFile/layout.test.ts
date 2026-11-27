import {applyOps, diffTrees} from '../ops';
import {fromOutline} from '../tree';
import {readLayout, writeLayout} from './frontmatter';
import {parseMapFile} from './parse';
import {reconcileTrees} from './reconcile';
import {newMapFileModel, serializeMapFile} from './serialize';

const file = (...front: string[]) => ['---', ...front, '---', '', '# Map', '', '- Plan', ''].join('\n');

describe('map layout in the frontmatter', () => {
    it('reads mindmap-layout into the tree', () => {
        const r = parseMapFile(file('mindmap: 1', 'mindmap-layout: logic'));
        expect(r.ok && r.model.tree.layout).toBe('logic');
        expect(r.diagnostics).toEqual([]);
    });

    it('has no layout without the key', () => {
        const r = parseMapFile(file('mindmap: 1'));
        expect(r.ok && 'layout' in r.model.tree).toBe(false);
    });

    it('warns about an unknown layout, ignores it and keeps the line', () => {
        const text = file('mindmap: 1', 'mindmap-layout: spiral');
        const r = parseMapFile(text);
        expect(r.ok).toBe(true);
        expect(r.ok && r.model.tree.layout).toBeUndefined();
        expect(r.diagnostics).toEqual([
            {
                line: 1,
                severity: 'warning',
                message: 'Unknown layout "spiral" in "mindmap-layout". Use one of: mindmap, logic, org.',
            },
        ]);
        if (r.ok) expect(serializeMapFile(r.model)).toBe(text);
    });

    it('accepts a quoted value', () => {
        expect(readLayout('mindmap-layout: "org"')).toEqual({layout: 'org'});
    });

    it('writes the layout after the mindmap flag and keeps other keys', () => {
        const model = {...newMapFileModel(), tree: {...fromOutline({text: 'Plan'}), layout: 'org' as const}};
        model.frontmatter = 'title: x\nmindmap: 1\nowner: me';
        expect(serializeMapFile(model)).toBe(file('title: x', 'mindmap: 1', 'mindmap-layout: org', 'owner: me'));
    });

    it('replaces the layout line in place, and removes it when the map has no layout', () => {
        expect(writeLayout('mindmap-layout: logic\nmindmap: 1', 'org')).toBe('mindmap-layout: org\nmindmap: 1');
        expect(writeLayout('mindmap: 1\nmindmap-layout: logic\nx: 1', undefined)).toBe('mindmap: 1\nx: 1');
        expect(writeLayout('mindmap: 1', undefined)).toBe('mindmap: 1');
    });

    it('round-trips byte for byte', () => {
        const text = file('mindmap: 1', 'mindmap-layout: logic');
        const r = parseMapFile(text);
        expect(r.ok && serializeMapFile(r.model)).toBe(text);
    });

    it('takes the layout of the file when reconciling', () => {
        const previous = {...fromOutline({text: 'Plan'}), layout: 'org' as const};
        expect(reconcileTrees(previous, {...fromOutline({text: 'Plan'}), layout: 'logic'}).layout).toBe('logic');
        expect('layout' in reconcileTrees(previous, fromOutline({text: 'Plan'}))).toBe(false);
    });
});

describe('setLayout op', () => {
    const tree = fromOutline({text: 'Plan'});

    it('sets and removes the layout', () => {
        const logic = applyOps(tree, [{op: 'setLayout', layout: 'logic'}]);
        expect(logic.tree.layout).toBe('logic');
        expect(applyOps(logic.tree, [{op: 'setLayout', layout: 'logic'}]).applied).toEqual([]);
        expect('layout' in applyOps(logic.tree, [{op: 'setLayout', layout: null}]).tree).toBe(false);
    });

    it('is produced by diffTrees', () => {
        const org = {...tree, layout: 'org' as const};
        expect(diffTrees(tree, org)).toEqual([{op: 'setLayout', layout: 'org'}]);
        expect(diffTrees(org, tree)).toEqual([{op: 'setLayout', layout: null}]);
        expect(applyOps(org, diffTrees(org, tree)).tree).toEqual(tree);
    });
});
