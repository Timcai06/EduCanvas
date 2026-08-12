import { describe, expect, it } from 'vitest';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import {
  canOpenResourceLibraryItem,
  getResourceLibraryActions,
  queryResourceLibrary,
} from './resource-library-model';

function makeSummary(
  resourceKind: 'source' | 'artifact',
  resourceId: string,
  overrides: Partial<WorkspaceResourceSummary> = {},
): WorkspaceResourceSummary {
  const base = {
    schemaVersion: 1,
    resourceKind,
    resourceId,
    notebookId: 'notebook-1',
    title: resourceId,
    updatedAt: '2026-08-13T00:00:00+08:00',
    status: 'ready' as const,
    renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
    version: { versionId: `${resourceId}-v1`, sequence: null },
    allowedActions: ['view', 'download'] as const,
    provenance: { sourceResourceIds: [], sourceReferences: [] },
    surface: { restState: null },
    ...(resourceKind === 'source' ? { context: { enabled: false } } : {}),
  };
  return { ...base, ...overrides } as WorkspaceResourceSummary;
}

describe('resource library model', () => {
  const summaries = [
    makeSummary('source', '数学讲义', {
      title: '数学讲义',
      updatedAt: '2026-08-12T00:00:00+08:00',
      context: { enabled: true },
    }),
    makeSummary('source', '英语讲义', {
      title: '英语讲义',
      status: 'processing',
      updatedAt: '2026-08-13T00:00:00+08:00',
      context: { enabled: false },
    }),
    makeSummary('artifact', '数学思维导图', {
      title: '数学思维导图',
      updatedAt: '2026-08-11T00:00:00+08:00',
      renderer: { rendererId: 'artifact.mind-map', rendererVersion: 1 },
      version: { versionId: 'map-v1', sequence: 1 },
    }),
  ];

  it('filters title, category, status and Source context without mutation', () => {
    const before = [...summaries];
    expect(
      queryResourceLibrary(summaries, {
        search: '数学',
        category: 'source',
        status: 'ready',
        contextEnabled: true,
      }),
    ).toHaveLength(1);
    expect(summaries).toEqual(before);
    expect(
      queryResourceLibrary(summaries, { contextEnabled: true }),
    ).toHaveLength(1);
  });

  it('sorts updatedAt/title/status stably in either direction', () => {
    expect(
      queryResourceLibrary(summaries, { sort: 'updatedAt', order: 'desc' }).map(
        (item) => item.resourceId,
      ),
    ).toEqual(['英语讲义', '数学讲义', '数学思维导图']);
    expect(
      queryResourceLibrary(summaries, { sort: 'status', order: 'asc' }).map(
        (item) => item.resourceId,
      ),
    ).toEqual(['英语讲义', '数学讲义', '数学思维导图']);
    expect(
      queryResourceLibrary(summaries, { sort: 'title', order: 'asc' }).map(
        (item) => item.resourceId,
      ),
    ).toEqual(['数学讲义', '数学思维导图', '英语讲义']);
  });

  it('returns only server-authorized actions', () => {
    const actions = getResourceLibraryActions(summaries[0]!);
    expect(actions).toEqual(['view', 'download']);
    expect(actions).not.toContain('delete');
    expect(canOpenResourceLibraryItem(summaries[0]!)).toBe(true);
    expect(
      canOpenResourceLibraryItem(
        makeSummary('source', 'blocked', { allowedActions: [] }),
      ),
    ).toBe(false);
  });

  it.each([0, 6, 7, 63, 256, 500])(
    'queries %i summaries without truncating the loaded result set',
    (count) => {
      const resources = Array.from({ length: count }, (_, index) =>
        makeSummary(
          index % 2 === 0 ? 'source' : 'artifact',
          `resource-${index}`,
          {
            title: `函数资源 ${String(index).padStart(3, '0')}`,
          },
        ),
      );

      expect(queryResourceLibrary(resources)).toHaveLength(count);
      expect(
        queryResourceLibrary(resources, {
          search: '函数资源',
          sort: 'title',
          order: 'asc',
        }),
      ).toHaveLength(count);
    },
  );
});
