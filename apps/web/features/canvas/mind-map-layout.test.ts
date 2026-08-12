import { describe, expect, it } from 'vitest';
import { buildMindMapLayout, nextVisibleNode } from './mind-map-layout';
import { mindMapContentSchema } from '@educanvas/canvas-protocol';

const v1Content = {
  contentVersion: 1,
  root: {
    id: 'root',
    label: '根节点',
    children: [
      {
        id: 'a',
        label: 'A',
        children: [{ id: 'a1', label: 'A-1' }],
      },
      {
        id: 'b',
        label: 'B',
      },
    ],
  },
};

const v2Content = {
  contentVersion: 2,
  rootNodeId: 'root',
  nodes: [
    { id: 'root', label: '根节点' },
    { id: 'a', label: 'A' },
    { id: 'a1', label: 'A-1' },
    { id: 'b', label: 'B' },
  ],
  edges: [
    { from: 'root', to: 'a' },
    { from: 'root', to: 'b' },
    { from: 'a', to: 'a1' },
  ],
};

describe('mind-map-layout', () => {
  it('v1 与 v2 的布局在同一输入上可复现（纯函数无副作用）', () => {
    const parsedV1 = mindMapContentSchema.parse(v1Content);
    const parsedV2 = mindMapContentSchema.parse(v2Content);

    const firstV1 = buildMindMapLayout(parsedV1);
    const secondV1 = buildMindMapLayout(parsedV1);
    const firstV2 = buildMindMapLayout(parsedV2);
    const secondV2 = buildMindMapLayout(parsedV2);

    expect(firstV1).toEqual(secondV1);
    expect(firstV2).toEqual(secondV2);
  });

  it('折叠节点会影响可见节点集合，且可见顺序稳定', () => {
    const parsedV1 = mindMapContentSchema.parse(v1Content);
    const expanded = buildMindMapLayout(parsedV1);
    expect(expanded.visibleNodeIds).toEqual(['root', 'a', 'a1', 'b']);

    const collapsed = buildMindMapLayout(parsedV1, new Set(['a', 'root']));
    expect(collapsed.visibleNodeIds).toEqual(['root']);
  });

  it('120 节点可达限制不引发布局抖动', () => {
    const content = {
      contentVersion: 2,
      rootNodeId: 'n0',
      nodes: Array.from({ length: 120 }, (_, index) => ({
        id: `n${index}`,
        label: `节点 ${index}`,
      })),
      edges: Array.from({ length: 119 }, (_, index) => ({
        from: 'n0',
        to: `n${index + 1}`,
      })),
    };

    const parsed = mindMapContentSchema.parse(content);
    const once = buildMindMapLayout(parsed);
    const twice = buildMindMapLayout(parsed);

    expect(once.visibleNodeIds).toHaveLength(120);
    expect(once).toEqual(twice);
    expect(once.visibleNodeIds[0]).toBe('n0');
    expect(once.visibleNodeIds.at(-1)).toBe('n119');
  });

  it('键盘导航在可见节点上可计算下一项', () => {
    const list = ['n0', 'n1', 'n2'];
    expect(nextVisibleNode(list, null, 'down')).toBe('n0');
    expect(nextVisibleNode(list, 'n0', 'down')).toBe('n1');
    expect(nextVisibleNode(list, 'n2', 'down')).toBe('n2');
    expect(nextVisibleNode(list, 'n2', 'up')).toBe('n1');
  });
});
