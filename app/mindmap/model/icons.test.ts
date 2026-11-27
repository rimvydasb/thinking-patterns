import {applyOps, diffTrees} from './ops';
import {ICON_GROUPS, normalizeIcons, splitLeadingIcons, toggleIcon} from './icons';
import {parseMapFile} from './mapFile/parse';
import {newMapFileModel, serializeMapFile} from './mapFile/serialize';
import {fromOutline, setIcons, toOutline} from './tree';
import {createMindMapStore} from '../store/mindmapStore';

describe('toggleIcon', () => {
    it('adds an icon of a new group at the end', () => {
        expect(toggleIcon(['one'], 'star')).toEqual(['one', 'star']);
    });
    it('replaces the icon of the same group in place', () => {
        expect(toggleIcon(['one', 'star'], 'three')).toEqual(['three', 'star']);
    });
    it('removes an icon the topic already has', () => {
        expect(toggleIcon(['one', 'star'], 'one')).toEqual(['star']);
        expect(toggleIcon(['one'], 'one', true)).toEqual(['one']);
    });
    it('ignores unknown codes', () => {
        expect(toggleIcon(['one'], 'nope')).toEqual(['one']);
        expect(normalizeIcons(['nope', 'one', 'two', 'star'])).toEqual(['two', 'star']);
    });
});

describe('splitLeadingIcons', () => {
    it('splits known shortcodes off the text', () => {
        expect(splitLeadingIcons(':one: :star: Launch')).toEqual({icons: ['one', 'star'], text: 'Launch'});
    });
    it('keeps unknown shortcodes and shortcodes later in the text', () => {
        expect(splitLeadingIcons(':nope: Launch :star:')).toEqual({icons: [], text: ':nope: Launch :star:'});
    });
    it('keeps the tokens as text when no text would be left', () => {
        expect(splitLeadingIcons(':star:')).toEqual({icons: [], text: ':star:'});
    });
});

describe('icons in the map file', () => {
    const tree = fromOutline({text: 'Root', icons: ['star'], children: [{text: 'A', icons: ['one', 'red_circle']}]});
    const file = serializeMapFile({...newMapFileModel(), tree});

    it('writes icons as shortcodes in front of the topic', () => {
        expect(file).toContain('- :star: Root\n  - :one: :red_circle: A');
    });

    it('reads them back', () => {
        const r = parseMapFile(file);
        if (!r.ok) throw new Error('parse failed');
        expect(toOutline(r.model.tree)).toEqual(toOutline(tree));
    });

    it('escapes text that starts with a shortcode, so it stays text', () => {
        const t = fromOutline({text: ':star: is text', children: [{text: 'B', icons: ['x']}]});
        const text = serializeMapFile({...newMapFileModel(), tree: t});
        expect(text).toContain('- \\:star: is text');
        const r = parseMapFile(text);
        if (!r.ok) throw new Error('parse failed');
        expect(toOutline(r.model.tree)).toEqual(toOutline(t));
    });
});

describe('setIcons op', () => {
    it('is produced by diffTrees and applied by applyOps', () => {
        const a = fromOutline({text: 'Root', children: [{text: 'A'}]});
        const b = setIcons(a, 'root.0', ['one']);
        const ops = diffTrees(a, b);
        expect(ops).toEqual([{op: 'setIcons', id: 'root.0', icons: ['one']}]);
        expect(applyOps(a, ops).tree.nodes['root.0'].icons).toEqual(['one']);
        expect(applyOps(b, [{op: 'setIcons', id: 'root.0', icons: []}]).tree.nodes['root.0'].icons).toBeUndefined();
    });
});

describe('store.pickIcon', () => {
    it('adds, replaces within a group and removes, as one undo step each', () => {
        const store = createMindMapStore({tree: fromOutline({text: 'Root'})});
        const icons = () => store.getState().tree.nodes.root.icons;
        store.getState().pickIcon('one');
        store.getState().pickIcon('star');
        expect(icons()).toEqual(['one', 'star']);
        store.getState().pickIcon('two');
        expect(icons()).toEqual(['two', 'star']);
        store.getState().pickIcon('star');
        expect(icons()).toEqual(['two']);
        store.getState().undo();
        expect(icons()).toEqual(['two', 'star']);
    });

    it('applies to all selected topics', () => {
        const store = createMindMapStore({tree: fromOutline({text: 'Root', children: [{text: 'A'}, {text: 'B'}]})});
        store.getState().select('root.0');
        store.getState().toggleSelect('root.1');
        store.getState().pickIcon('star');
        const {nodes} = store.getState().tree;
        expect([nodes['root.0'].icons, nodes['root.1'].icons]).toEqual([['star'], ['star']]);
    });
});

describe('ICON_GROUPS', () => {
    it('fills whole panel rows (7 per row) and has unique shortcodes', () => {
        for (const g of ICON_GROUPS) expect([g.id, g.icons.length % 7]).toEqual([g.id, 0]);
        const codes = ICON_GROUPS.flatMap((g) => g.icons.map((i) => i.code));
        expect(new Set(codes).size).toBe(codes.length);
    });
});
