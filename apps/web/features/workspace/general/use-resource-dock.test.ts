import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { appendResourceDockPage } from './use-resource-dock';

const source = readFileSync(
  fileURLToPath(new URL('./use-resource-dock.ts', import.meta.url)),
  'utf8',
);

function summary(
  resourceKind: 'source' | 'artifact',
  resourceId: string,
): WorkspaceResourceSummary {
  return {
    schemaVersion: 1,
    resourceKind,
    resourceId,
    notebookId: 'notebook-1',
    title: resourceId,
    updatedAt: '2026-08-13T00:00:00.000Z',
    status: 'ready',
    renderer: { rendererId: 'test.renderer', rendererVersion: 1 },
    version: {
      versionId: `${resourceId}-v1`,
      sequence: resourceKind === 'source' ? null : 1,
    },
    allowedActions: ['view'],
    provenance: { sourceResourceIds: [], sourceReferences: [] },
    surface: { restState: null },
    ...(resourceKind === 'source' ? { context: { enabled: true } } : {}),
  } as WorkspaceResourceSummary;
}

describe('useResourceDock page seam', () => {
  it('累积 all-filter 页面，按 kind/id 去重并暴露 hasMore', () => {
    const first = appendResourceDockPage([], {
      items: [summary('source', 's1'), summary('artifact', 'a1')],
      nextCursor: 'cursor-1',
    });
    const second = appendResourceDockPage(first.items, {
      items: [summary('source', 's1'), summary('source', 's2')],
      nextCursor: null,
    });

    expect(first).toMatchObject({ nextCursor: 'cursor-1', hasMore: true });
    expect(second.items.map((item) => item.resourceId)).toEqual([
      's1',
      'a1',
      's2',
    ]);
    expect(second).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it('空页且无 cursor 不制造更多页', () => {
    expect(appendResourceDockPage([], { items: [], nextCursor: null })).toEqual(
      {
        items: [],
        nextCursor: null,
        hasMore: false,
      },
    );
  });

  it('跨页重复资源不会改变稳定 identity 集合', () => {
    const current = [summary('source', 's1')];
    expect(
      appendResourceDockPage(current, {
        items: [summary('source', 's1')],
        nextCursor: 'cursor-2',
      }).items,
    ).toEqual(current);
  });

  it('500 条跨页摘要合并只按稳定 identity 去重且不丢失末页', () => {
    const firstPage = Array.from({ length: 256 }, (_, index) =>
      summary(index % 2 === 0 ? 'source' : 'artifact', `resource-${index}`),
    );
    const secondPage = Array.from({ length: 256 }, (_, index) =>
      summary(
        index % 2 === 0 ? 'source' : 'artifact',
        `resource-${index + 244}`,
      ),
    );
    const first = appendResourceDockPage([], {
      items: firstPage,
      nextCursor: 'cursor-256',
    });
    const completed = appendResourceDockPage(first.items, {
      items: secondPage,
      nextCursor: null,
    });

    expect(first.hasMore).toBe(true);
    expect(completed.hasMore).toBe(false);
    expect(completed.items).toHaveLength(500);
    expect(
      new Set(
        completed.items.map(
          (item) => `${item.resourceKind}:${item.resourceId}`,
        ),
      ).size,
    ).toBe(500);
  });

  it('reload 保留旧列表只置 loading：展开 Dock 触发刷新时不先清空闪屏', () => {
    expect(source).toContain('items: current.items');
    expect(source).toContain('loading: true');
    expect(source).toContain('itemsRef.current = [];');
    expect(source).toContain('cursorRef.current = null;');
  });
});
