import { describe, expect, it } from 'vitest';
import { projectCanvasResourceForNonWeb } from './non-web-projection';

function resource(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resourceId: 'source:1',
    notebookId: 'notebook:1',
    resourceKind: 'source',
    title: '线性代数笔记',
    status: 'ready',
    version: {
      versionId: 'version:1',
      sequence: null,
      checksum: 'a'.repeat(64),
    },
    representation: { kind: 'text', mimeType: 'text/plain', byteSize: 12 },
    renderer: { rendererId: 'source.text', rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-08-04T00:00:00.000Z',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

describe('projectCanvasResourceForNonWeb', () => {
  it('allows a ready text resource to use bounded inline text', () => {
    expect(
      projectCanvasResourceForNonWeb({
        resource: resource(),
        currentNotebookId: 'notebook:1',
      }),
    ).toMatchObject({ available: true, openMode: 'inline_text' });
  });

  it('requires a Web handoff for media and Runtime resources', () => {
    const image = resource({
      resourceKind: 'artifact',
      representation: { kind: 'image', mimeType: 'image/png', byteSize: 10 },
      renderer: {
        rendererId: 'artifact.generated-image',
        rendererVersion: 1,
      },
      trustTier: 'tier2',
    });
    const runtime = resource({
      resourceKind: 'artifact',
      representation: {
        kind: 'interactive_app',
        mimeType: 'application/vnd.educanvas.dom-exploration+json',
        byteSize: null,
      },
      renderer: {
        rendererId: 'artifact.dom-exploration',
        rendererVersion: 1,
      },
      trustTier: 'tier2',
      runtime: {
        kind: 'web_sandbox',
        protocolVersion: 1,
        maxDurationMs: 30_000,
        maxOutputBytes: 1_024,
        network: 'none',
      },
    });

    expect(
      projectCanvasResourceForNonWeb({
        resource: image,
        currentNotebookId: 'notebook:1',
      }),
    ).toMatchObject({ available: true, openMode: 'web_handoff' });
    expect(
      projectCanvasResourceForNonWeb({
        resource: runtime,
        currentNotebookId: 'notebook:1',
      }),
    ).toMatchObject({
      available: true,
      openMode: 'web_handoff',
      runtimeKind: 'web_sandbox',
    });
  });

  it.each(['processing', 'failed', 'unavailable', 'archived'])(
    'does not offer an open action for %s resources',
    (status) => {
      expect(
        projectCanvasResourceForNonWeb({
          resource: resource({ status }),
          currentNotebookId: 'notebook:1',
        }),
      ).toMatchObject({ available: true, status, openMode: 'none' });
    },
  );

  it('hides cross-Notebook resources without echoing their metadata', () => {
    const projection = projectCanvasResourceForNonWeb({
      resource: resource(),
      currentNotebookId: 'notebook:other',
    });
    expect(projection).toEqual({
      available: false,
      reason: 'resource_not_found',
    });
    expect(JSON.stringify(projection)).not.toContain('线性代数笔记');
  });

  it('rejects unreviewed fields instead of leaking them', () => {
    const projection = projectCanvasResourceForNonWeb({
      resource: resource({ storageKey: 'private/object-key' }),
      currentNotebookId: 'notebook:1',
    });
    expect(projection).toEqual({
      available: false,
      reason: 'resource_invalid',
    });
    expect(JSON.stringify(projection)).not.toContain('private/object-key');
  });
});
