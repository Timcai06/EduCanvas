import { describe, expect, it } from 'vitest';
import {
  MIND_MAP_CONTENT_VERSION_V1,
  MIND_MAP_CONTENT_VERSION_V2,
  mindMapContentSchema,
  type MindMapNode,
} from './mind-map';

const node = (id: string, children?: MindMapNode[]): MindMapNode => ({
  id,
  label: `节点 ${id}`,
  ...(children ? { children } : {}),
});

describe('mindMapContentSchema', () => {
  it('接受合法嵌套导图', () => {
    const result = mindMapContentSchema.safeParse({
      contentVersion: MIND_MAP_CONTENT_VERSION_V1,
      root: node('root', [node('a', [node('a1')]), node('b')]),
    });
    expect(result.success).toBe(true);
  });

  it('拒绝超过 4 层深度', () => {
    const deep = node('1', [node('2', [node('3', [node('4', [node('5')])])])]);
    const result = mindMapContentSchema.safeParse({
      contentVersion: MIND_MAP_CONTENT_VERSION_V1,
      root: deep,
    });
    expect(result.success).toBe(false);
  });

  it('拒绝超过 120 节点', () => {
    const children = Array.from({ length: 12 }, (_, branch) =>
      node(
        `b${branch}`,
        Array.from({ length: 10 }, (_, leaf) => node(`b${branch}l${leaf}`)),
      ),
    );
    const result = mindMapContentSchema.safeParse({
      contentVersion: MIND_MAP_CONTENT_VERSION_V1,
      root: node('root', children),
    });
    expect(result.success).toBe(false);
  });

  it('拒绝非法 id、超长标签与未知字段', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V1,
        root: { id: '包含空格 ', label: 'x' },
      }).success,
    ).toBe(false);
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V1,
        root: { id: 'a', label: 'x'.repeat(121) },
      }).success,
    ).toBe(false);
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V1,
        root: { id: 'a', label: 'x', extra: true },
      }).success,
    ).toBe(false);
  });

  it('接受合法 v2 平面图数据', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '根', semanticRole: 'root' },
          { id: 'topic-a', label: '主题A', semanticRole: 'topic' },
          { id: 'topic-b', label: '主题B', semanticRole: 'topic' },
          { id: 'detail', label: '细节', semanticRole: 'detail' },
        ],
        edges: [
          { from: 'root', to: 'topic-a', semanticRole: 'hierarchy' },
          { from: 'root', to: 'topic-b', semanticRole: 'hierarchy' },
          { from: 'topic-a', to: 'detail', semanticRole: 'hierarchy' },
        ],
        groups: [{ id: 'g1', label: '组1', nodeIds: ['topic-a', 'topic-b'] }],
      }).success,
    ).toBe(true);
  });

  it('语义关联边不改变层级父子、唯一根与深度', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '根' },
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [
          { from: 'root', to: 'a', semanticRole: 'hierarchy' },
          { from: 'root', to: 'b', semanticRole: 'hierarchy' },
          { from: 'a', to: 'b', semanticRole: 'association' },
        ],
      }).success,
    ).toBe(true);
  });

  it('拒绝未知 contentVersion', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: 3,
        root: node('root'),
      }).success,
    ).toBe(false);
  });

  it('拒绝自环/重复边/越权引用', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [{ id: 'root', label: '根' }],
        edges: [{ from: 'root', to: 'root' }],
      }).success,
    ).toBe(false);

    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [{ id: 'root', label: '根' }],
        edges: [{ from: 'root', to: 'missing' }],
      }).success,
    ).toBe(false);

    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '根' },
          { id: 'a', label: 'A' },
        ],
        edges: [
          { from: 'root', to: 'a' },
          { from: 'root', to: 'a' },
        ],
      }).success,
    ).toBe(false);
  });

  it('拒绝循环图和不可达节点', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '根' },
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [
          { from: 'root', to: 'a' },
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      }).success,
    ).toBe(false);

    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '根' },
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [{ from: 'root', to: 'a' }],
      }).success,
    ).toBe(false);
  });

  it('拒绝一个节点拥有多个层级父级', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: MIND_MAP_CONTENT_VERSION_V2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '根' },
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'shared', label: '共享子节点' },
        ],
        edges: [
          { from: 'root', to: 'a', semanticRole: 'hierarchy' },
          { from: 'root', to: 'b', semanticRole: 'hierarchy' },
          { from: 'a', to: 'shared', semanticRole: 'hierarchy' },
          { from: 'b', to: 'shared', semanticRole: 'hierarchy' },
        ],
      }).success,
    ).toBe(false);
  });
});
