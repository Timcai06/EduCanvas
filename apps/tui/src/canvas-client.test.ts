import { describe, expect, it, vi } from 'vitest';
import { openTuiCanvasResource } from './canvas-client';

const token = 'a'.repeat(43);

function resource(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resourceId: 'source:1',
    notebookId: 'notebook:1',
    resourceKind: 'source',
    title: '课堂笔记',
    status: 'ready',
    version: {
      versionId: 'version:1',
      sequence: null,
      checksum: 'a'.repeat(64),
    },
    representation: { kind: 'text', mimeType: 'text/plain', byteSize: 20 },
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

function input(overrides: Record<string, unknown> = {}) {
  return {
    resource: resource(),
    currentNotebookId: 'notebook:1',
    conversationId: 'conversation:1',
    webBaseUrl: 'http://127.0.0.1:3101',
    issueHandoff: vi.fn(async () => ({
      token,
      expiresAt: '2026-08-04T00:02:00.000Z',
    })),
    ...overrides,
  };
}

describe('openTuiCanvasResource', () => {
  it('opens bounded text through a resource-scoped loader', async () => {
    const loadText = vi.fn(async () => '矩阵是线性变换的表示。');
    const request = input({ loadText });
    await expect(openTuiCanvasResource(request)).resolves.toEqual({
      kind: 'inline_text',
      title: '课堂笔记',
      text: '矩阵是线性变换的表示。',
    });
    expect(loadText).toHaveBeenCalledWith({
      notebookId: 'notebook:1',
      resourceKind: 'source',
      resourceId: 'source:1',
      maxChars: 16_000,
    });
    expect(request.issueHandoff).not.toHaveBeenCalled();
  });

  it('rejects oversized text instead of truncating private content silently', async () => {
    await expect(
      openTuiCanvasResource(
        input({ loadText: async () => 'x'.repeat(16_001) }),
      ),
    ).resolves.toEqual({
      kind: 'unavailable',
      reason: 'text_unavailable',
    });
  });

  it('uses a one-time notebook handoff for media artifacts', async () => {
    const request = input({
      resource: resource({
        resourceKind: 'artifact',
        representation: {
          kind: 'image',
          mimeType: 'image/png',
          byteSize: 20,
        },
        renderer: {
          rendererId: 'artifact.generated-image',
          rendererVersion: 1,
        },
        trustTier: 'tier2',
      }),
    });
    const result = await openTuiCanvasResource(request);
    expect(result).toMatchObject({
      kind: 'web_handoff',
      title: '课堂笔记',
      expiresAt: '2026-08-04T00:02:00.000Z',
    });
    expect(result.kind === 'web_handoff' ? result.url : '').toBe(
      `http://127.0.0.1:3101/open?token=${token}`,
    );
    expect(JSON.stringify(result)).not.toContain('source:1');
    expect(request.issueHandoff).toHaveBeenCalledWith('conversation:1');
  });

  it('hands Runtime resources to Web without executing them', async () => {
    const spawnRuntime = vi.fn();
    const result = await openTuiCanvasResource(
      input({
        resource: resource({
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
        }),
        spawnRuntime,
      }),
    );
    expect(result.kind).toBe('web_handoff');
    expect(spawnRuntime).not.toHaveBeenCalled();
  });

  it('hides cross-Notebook resources and does not call either capability', async () => {
    const loadText = vi.fn(async () => 'private');
    const request = input({
      currentNotebookId: 'notebook:other',
      loadText,
    });
    await expect(openTuiCanvasResource(request)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'resource_not_found',
    });
    expect(loadText).not.toHaveBeenCalled();
    expect(request.issueHandoff).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials and unsafe Web base URLs', async () => {
    await expect(
      openTuiCanvasResource(
        input({
          resource: resource({
            representation: {
              kind: 'image',
              mimeType: 'image/png',
              byteSize: 20,
            },
          }),
          webBaseUrl: 'file:///tmp/private',
        }),
      ),
    ).resolves.toEqual({
      kind: 'unavailable',
      reason: 'handoff_unavailable',
    });
  });
});
