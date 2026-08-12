import { describe, expect, it } from 'vitest';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { buildResourceDockModel } from './resource-dock-model';

function summary(
  resourceKind: 'source' | 'artifact',
  id: string,
): WorkspaceResourceSummary {
  return {
    schemaVersion: 1,
    resourceKind,
    resourceId: id,
    notebookId: 'notebook-1',
    title: id,
    updatedAt: '2026-08-13T00:00:00+08:00',
    status: 'ready',
    renderer: {
      rendererId:
        resourceKind === 'source' ? 'source.pdf' : 'artifact.markdown-document',
      rendererVersion: 1,
    },
    version: {
      versionId: `${id}-v1`,
      sequence: resourceKind === 'source' ? null : 1,
    },
    allowedActions: ['view'],
    provenance: { sourceResourceIds: [], sourceReferences: [] },
    surface: { restState: 'pinned' },
    ...(resourceKind === 'source' ? { context: { enabled: true } } : {}),
  } as WorkspaceResourceSummary;
}

describe('resource dock model', () => {
  it.each([0, 6, 7, 63, 256, 500])(
    'keeps all %i loaded summaries recoverable while bounding the quick area',
    (count) => {
      const summaries = Array.from({ length: count }, (_, index) =>
        summary(index % 2 === 0 ? 'source' : 'artifact', `resource-${index}`),
      );
      const model = buildResourceDockModel(summaries, { visibleLimit: 6 });
      const all = model.sections.find((section) => section.id === 'all')!;

      expect(all.items).toHaveLength(count);
      expect(all.visibleItems).toHaveLength(Math.min(count, 6));
      expect(all.hiddenLoadedCount).toBe(Math.max(0, count - 6));
      expect(
        model.sections
          .filter((section) => section.id !== 'all')
          .flatMap((section) => section.items),
      ).toHaveLength(count);
    },
  );

  it('keeps stable categories and every summary without six-item truncation', () => {
    const summaries = Array.from({ length: 7 }, (_, index) =>
      summary('source', `source-${index}`),
    );
    const model = buildResourceDockModel(summaries, {
      visibleLimit: 6,
      hasUnloadedPages: true,
    });
    expect(model.sections.map((section) => section.id)).toEqual([
      'source',
      'artifact',
      'all',
    ]);
    expect(model.sections[0]!.items).toHaveLength(7);
    expect(model.sections[0]!.visibleItems).toHaveLength(6);
    expect(model.sections[0]).toMatchObject({
      hiddenLoadedCount: 1,
      hasUnloadedPages: true,
    });
    expect(model.sections[2]!.items).toHaveLength(7);
  });

  it('preserves renderer, lifecycle, context and surface facts', () => {
    const item = buildResourceDockModel([summary('source', 's1')]).sections[0]!
      .items[0]!;
    expect(item).toMatchObject({
      rendererId: 'source.pdf',
      status: 'ready',
      contextEnabled: true,
      surfaceRestState: 'pinned',
    });
  });
});
