import { fromOutline, addChild, setCollapsed } from '../model/tree';
import type { LayoutKind } from '../model/types';
import { computeLayout, withProvisionalNodes, type PlacedNode } from './elkLayout';
import { estimateTextWidth, measureTopic, wrapText } from './measure';
import { branchColor, isLight, mix, topicColors } from './theme';

const tree = fromOutline({
  text: 'Software Factory',
  children: [
    { text: 'Loops', children: [{ text: 'Forward Pressure' }, { text: 'Backward pressure' }] },
    {
      text: 'Software Quality Attributes',
      children: [{ text: 'Availability' }, { text: 'Performance', children: [{ text: 'k6' }] }, { text: 'Security' }],
    },
    { text: 'Formal Verification For Each software attribute' },
    { text: 'Events', children: [{ text: 'Domain events' }] },
  ],
});

const overlaps = (a: PlacedNode, b: PlacedNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const layout = (kind: LayoutKind, t = tree) => computeLayout(t, kind, estimateTextWidth);

describe('measure', () => {
  it('wraps long text at the max width', () => {
    const lines = wrapText('one two three four', 30, '14px x', estimateTextWidth);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four');
  });

  it('keeps explicit newlines', () => {
    expect(wrapText('a\nb', 1000, '14px x', estimateTextWidth)).toEqual(['a', 'b']);
  });

  it('makes the root larger than subtopics', () => {
    const root = measureTopic('Topic', 0, estimateTextWidth);
    const sub = measureTopic('Topic', 2, estimateTextWidth);
    expect(root.width).toBeGreaterThan(sub.width);
    expect(root.height).toBeGreaterThan(sub.height);
  });

  it('grows height for multi-line text', () => {
    const one = measureTopic('x', 1, estimateTextWidth);
    const two = measureTopic('x\ny', 1, estimateTextWidth);
    expect(two.height).toBeGreaterThan(one.height);
  });
});

describe('computeLayout', () => {
  it.each(['mindmap', 'logic', 'org'] as const)('%s: places every visible node without overlaps', async (kind) => {
    const r = await layout(kind);
    const nodes = Object.values(r.nodes);
    expect(nodes).toHaveLength(Object.keys(tree.nodes).length);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) expect(overlaps(nodes[i], nodes[j])).toBe(false);
    expect(r.edges).toHaveLength(nodes.length - 1);
    expect(r.nodes.root).toMatchObject({ x: 0, y: 0, depth: 0, side: null });
  });

  it('logic: children to the right of parents, siblings keep model order', async () => {
    const { nodes } = await layout('logic');
    for (const id of ['root.0', 'root.1', 'root.2', 'root.3']) {
      expect(nodes[id].x).toBeGreaterThan(nodes.root.x + nodes.root.width);
      expect(nodes[id].side).toBe('right');
    }
    expect(nodes['root.0'].y).toBeLessThan(nodes['root.1'].y);
    expect(nodes['root.1'].y).toBeLessThan(nodes['root.2'].y);
    expect(nodes['root.1.1.0'].x).toBeGreaterThan(nodes['root.1.1'].x + nodes['root.1.1'].width);
  });

  it('logic: aligns each depth column on its left edge', async () => {
    const { nodes } = await layout('logic');
    expect(new Set(['root.0', 'root.1', 'root.2', 'root.3'].map((id) => nodes[id].x)).size).toBe(1);
  });

  it('mindmap: first half right, second half left', async () => {
    const { nodes } = await layout('mindmap');
    expect(nodes['root.0'].x).toBeGreaterThan(nodes.root.width);
    expect(nodes['root.1'].side).toBe('right');
    expect(nodes['root.2'].x + nodes['root.2'].width).toBeLessThan(0);
    expect(nodes['root.3'].side).toBe('left');
    expect(nodes['root.3.0'].x + nodes['root.3.0'].width).toBeLessThan(nodes['root.3'].x);
  });

  it('org: children below parents', async () => {
    const { nodes } = await layout('org');
    expect(nodes['root.0'].y).toBeGreaterThan(nodes.root.height);
    expect(nodes['root.0'].x).toBeLessThan(nodes['root.1'].x);
    expect(nodes['root.0.0'].y).toBeGreaterThan(nodes['root.0'].y + nodes['root.0'].height);
  });

  it('skips descendants of collapsed nodes', async () => {
    const r = await layout('logic', setCollapsed(tree, 'root.1', true));
    expect(r.nodes['root.1']).toBeDefined();
    expect(r.nodes['root.1.0']).toBeUndefined();
    expect(r.edges.find((e) => e.source === 'root.1')).toBeUndefined();
  });

  it('handles a lone root', async () => {
    const r = await layout('mindmap', fromOutline({ text: 'Only' }));
    expect(Object.keys(r.nodes)).toEqual(['root']);
    expect(r.edges).toEqual([]);
  });
});

describe('withProvisionalNodes', () => {
  it('places nodes that are newer than the layout next to their parent', async () => {
    const r = await layout('logic');
    const { tree: next, id } = addChild(tree, 'root.0', { id: 'new', text: 'New' });
    const p = withProvisionalNodes(r, next, 'logic', estimateTextWidth);
    const parent = p.nodes['root.0'];
    expect(p.nodes[id]).toMatchObject({ depth: 2, side: 'right' });
    expect(p.nodes[id].x).toBeGreaterThan(parent.x + parent.width);
    expect(p.edges).toContainEqual({ source: 'root.0', target: id, side: 'right' });
    expect(withProvisionalNodes(r, tree, 'logic', estimateTextWidth)).toBe(r);
  });

  it('drops nodes that no longer exist', async () => {
    const r = await layout('logic');
    const next = setCollapsed(tree, 'root.1', true);
    const p = withProvisionalNodes(r, next, 'logic', estimateTextWidth);
    expect(p.nodes['root.1.0']).toBeUndefined();
    expect(p.edges.every((e) => p.nodes[e.source] && p.nodes[e.target])).toBe(true);
  });
});

describe('theme', () => {
  it('cycles branch colours', () => {
    expect(branchColor(0)).toBe(branchColor(8));
    expect(branchColor(-1)).not.toBe(branchColor(0));
  });

  it('mixes colours', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(isLight('#ffffff')).toBe(true);
    expect(isLight('#0b1660')).toBe(false);
  });

  it('uses readable text on main topics', () => {
    expect(topicColors(1, 0).text).not.toBe('#FFFFFF'); // yellow branch → dark text
    expect(topicColors(1, 2).text).toBe('#FFFFFF');
    expect(topicColors(3, 1).background).toBe('transparent');
  });
});
