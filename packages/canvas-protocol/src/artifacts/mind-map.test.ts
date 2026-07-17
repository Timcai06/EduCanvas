import { describe, expect, it } from 'vitest';
import { mindMapContentSchema, type MindMapNode } from './mind-map';

const node = (id: string, children?: MindMapNode[]): MindMapNode => ({
  id,
  label: `节点 ${id}`,
  ...(children ? { children } : {}),
});

describe('mindMapContentSchema', () => {
  it('接受合法嵌套导图', () => {
    const result = mindMapContentSchema.safeParse({
      contentVersion: 1,
      root: node('root', [node('a', [node('a1')]), node('b')]),
    });
    expect(result.success).toBe(true);
  });

  it('拒绝超过 4 层深度', () => {
    const deep = node('1', [node('2', [node('3', [node('4', [node('5')])])])]);
    const result = mindMapContentSchema.safeParse({
      contentVersion: 1,
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
      contentVersion: 1,
      root: node('root', children),
    });
    expect(result.success).toBe(false);
  });

  it('拒绝非法 id、超长标签与未知字段', () => {
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: 1,
        root: { id: '包含空格 ', label: 'x' },
      }).success,
    ).toBe(false);
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: 1,
        root: { id: 'a', label: 'x'.repeat(121) },
      }).success,
    ).toBe(false);
    expect(
      mindMapContentSchema.safeParse({
        contentVersion: 1,
        root: { id: 'a', label: 'x', extra: true },
      }).success,
    ).toBe(false);
  });
});
