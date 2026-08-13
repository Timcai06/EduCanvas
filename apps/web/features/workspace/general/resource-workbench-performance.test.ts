import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { queryResourceLibrary } from '@/features/studio/resource-library-model';
import { buildResourceDockModel } from './resource-dock-model';

function summary(index: number): WorkspaceResourceSummary {
  const resourceKind = index % 2 === 0 ? 'source' : 'artifact';
  const base = {
    schemaVersion: 1,
    resourceKind,
    resourceId: `resource-${index}`,
    notebookId: 'notebook-performance',
    title: `函数资源 ${String(index).padStart(3, '0')}`,
    updatedAt: new Date(Date.UTC(2026, 7, 13, 0, 0, index)).toISOString(),
    status: 'ready' as const,
    renderer: { rendererId: 'test.renderer', rendererVersion: 1 },
    version: {
      versionId: `version-${index}`,
      sequence: resourceKind === 'source' ? null : index + 1,
    },
    allowedActions: ['view'] as const,
    provenance: { sourceResourceIds: [], sourceReferences: [] },
    surface: { restState: null },
    ...(resourceKind === 'source' ? { context: { enabled: true } } : {}),
  };
  return Object.defineProperties(base, {
    content: {
      get: () => {
        throw new Error('正文不应在摘要查询中读取');
      },
    },
    objectKey: {
      get: () => {
        throw new Error('对象 key 不应在摘要查询中读取');
      },
    },
    binary: {
      get: () => {
        throw new Error('二进制不应在摘要查询中读取');
      },
    },
  }) as unknown as WorkspaceResourceSummary;
}

function percentile95(samples: readonly number[]): number {
  return [...samples].sort((left, right) => left - right)[
    Math.ceil(samples.length * 0.95) - 1
  ]!;
}

describe('resource workbench summary budgets', () => {
  it('500-summary Dock projection and local search stay within the 100ms p95 budget', () => {
    const summaries = Array.from({ length: 500 }, (_, index) => summary(index));
    const dockSamples: number[] = [];
    const searchSamples: number[] = [];

    for (let iteration = 0; iteration < 25; iteration += 1) {
      let started = performance.now();
      const dock = buildResourceDockModel(summaries, { visibleLimit: 6 });
      dockSamples.push(performance.now() - started);
      expect(dock.sections[2]!.items).toHaveLength(500);

      started = performance.now();
      const results = queryResourceLibrary(summaries, {
        search: '函数资源',
        sort: 'title',
        order: iteration % 2 === 0 ? 'asc' : 'desc',
      });
      searchSamples.push(performance.now() - started);
      expect(results).toHaveLength(500);
    }

    expect(percentile95(dockSamples)).toBeLessThan(100);
    expect(percentile95(searchSamples)).toBeLessThan(100);
  });

  it('summary-only unopened projections issue no detail/body/media request', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected resource detail request'));
    const summaries = Array.from({ length: 500 }, (_, index) => summary(index));

    expect(() =>
      buildResourceDockModel(summaries, { visibleLimit: 6 }),
    ).not.toThrow();
    expect(() =>
      queryResourceLibrary(summaries, { search: '函数' }),
    ).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
