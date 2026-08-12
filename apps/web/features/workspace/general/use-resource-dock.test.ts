import { describe, expect, it } from 'vitest';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { appendResourceDockPage } from './use-resource-dock';

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
});
