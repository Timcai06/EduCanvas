import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeMarkdownVersionDiff,
  MarkdownVersionDiffPanel,
} from './markdown-version-diff';

function makeMarkdownVersion(version: number, markdown: string) {
  return {
    version,
    contentVersion: 1,
    content: {
      contentVersion: 1,
      markdown,
    },
  };
}

describe('computeMarkdownVersionDiff', () => {
  it('能计算添加/删除行并返回最多 8 行摘要', () => {
    const previous = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
    const latest = ['1', '2', '3', 'a', 'b', 'c', '7', '8', '9'].join('\n');
    const result = computeMarkdownVersionDiff(previous, latest, 2);

    expect(result.addedCount).toBe(3);
    expect(result.removedCount).toBe(3);
    expect(result.addedLines).toEqual(['a', 'b']);
    expect(result.removedLines).toEqual(['4', '5']);
  });

  it('无差异时返回 0', () => {
    const result = computeMarkdownVersionDiff('a\nb\nc', 'a\nb\nc');
    expect(result).toEqual({
      addedCount: 0,
      removedCount: 0,
      addedLines: [],
      removedLines: [],
    });
  });
});

describe('MarkdownVersionDiffPanel SSR 初态', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('只读历史 markdown 默认展示加载状态', () => {
    const html = renderToStaticMarkup(
      <MarkdownVersionDiffPanel
        artifactId="art-1"
        displayedVersion={1}
        version={makeMarkdownVersion(1, '# 旧版')}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('正在获取最新版本差异');
  });
});
