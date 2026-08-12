import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MindMapRenderer } from './mind-map-renderer';

const v1Content = {
  contentVersion: 1,
  root: {
    id: 'root',
    label: '根节点',
    children: [{ id: 'topic-1', label: '一级节点' }],
  },
};

const v2Content = {
  contentVersion: 2,
  rootNodeId: 'root',
  nodes: [
    { id: 'root', label: '根节点' },
    { id: 'topic-1', label: '一级节点' },
  ],
  edges: [{ from: 'root', to: 'topic-1' }],
};

describe('MindMapRenderer', () => {
  it.each([
    ['v1', v1Content],
    ['v2', v2Content],
  ])('%s 历史与当前内容共享无障碍渲染链', (_label, content) => {
    const html = renderToStaticMarkup(<MindMapRenderer content={content} />);

    expect(html).toContain('role="tree"');
    expect(html.match(/role="treeitem"/g)).toHaveLength(2);
    expect(html).toContain('根节点');
    expect(html).toContain('一级节点');
    expect(html).toContain('提问：一级节点');
  });

  it('非法内容显示稳定错误态而不是抛出', () => {
    const html = renderToStaticMarkup(
      <MindMapRenderer
        content={{
          contentVersion: 2,
          rootNodeId: 'root',
          nodes: [],
          edges: [],
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('内容格式有问题');
  });
});
