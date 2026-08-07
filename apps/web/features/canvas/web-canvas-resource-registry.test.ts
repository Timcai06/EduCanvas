import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasResource } from '@educanvas/canvas-protocol';

vi.mock('./canvas-resource-renderers', () => ({
  MindMapResourceRenderer: () => null,
  SlidesResourceRenderer: () => null,
  FlashcardsResourceRenderer: () => null,
  AudioOverviewResourceRenderer: () => null,
  GeneratedImageResourceRenderer: () => null,
  SourcePdfResourceRenderer: () => null,
  SourceImageResourceRenderer: () => null,
  SourceMarkdownResourceRenderer: () => null,
  SourceTextResourceRenderer: () => null,
  SourceDocxResourceRenderer: () => null,
  SourceAudioResourceRenderer: () => null,
  SourceVideoResourceRenderer: () => null,
}));

const { webCanvasResourceRegistry, selectWebCanvasResourceRenderer } =
  await import('./web-canvas-resource-registry');

function makeResource(
  rendererId: string,
  overrides: Partial<CanvasResource> = {},
): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    notebookId: 'bbbb0000-0000-4000-8000-000000000001',
    resourceKind: 'source',
    title: '测试资源',
    status: 'ready',
    version: {
      versionId: 'cccc0000-0000-4000-8000-000000000001',
      sequence: 1,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 1024,
    },
    renderer: { rendererId, rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-28T00:00:00.000Z',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webCanvasResourceRegistry', () => {
  it('registry 不为空且已冻结', () => {
    expect(webCanvasResourceRegistry.size).toBe(12);
  });

  describe('Source rendererId 选择', () => {
    it('source.pdf 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.pdf', {
          allowedActions: ['view', 'download', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('source.image 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.image', {
          representation: {
            kind: 'image',
            mimeType: 'image/png',
            byteSize: null,
          },
          allowedActions: ['view', 'download', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('source.markdown 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.markdown', {
          representation: {
            kind: 'text',
            mimeType: 'text/markdown',
            byteSize: null,
          },
          allowedActions: ['view', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('source.text 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.text', {
          representation: {
            kind: 'text',
            mimeType: 'text/plain',
            byteSize: null,
          },
          allowedActions: ['view', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('source.docx 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.docx', {
          allowedActions: ['view', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('source.audio 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.audio', {
          representation: {
            kind: 'audio',
            mimeType: 'audio/mpeg',
            byteSize: null,
          },
          allowedActions: ['view', 'download', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('source.video 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.video', {
          representation: {
            kind: 'video',
            mimeType: 'video/mp4',
            byteSize: null,
          },
          allowedActions: ['view', 'download', 'rename', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });
  });

  describe('Artifact rendererId 选择', () => {
    it('artifact.mind-map 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.mind-map', {
          resourceKind: 'artifact',
          representation: {
            kind: 'structured',
            mimeType: 'application/json',
            byteSize: null,
          },
          allowedActions: ['view', 'regenerate'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('artifact.slides 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.slides', {
          resourceKind: 'artifact',
          representation: {
            kind: 'structured',
            mimeType: 'application/json',
            byteSize: null,
          },
          allowedActions: ['view', 'regenerate'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('artifact.flashcards 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.flashcards', {
          resourceKind: 'artifact',
          representation: {
            kind: 'structured',
            mimeType: 'application/json',
            byteSize: null,
          },
          allowedActions: ['view', 'regenerate'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('artifact.note 未注册 → rendererId_not_registered（交互式产物由壳渲染，Registry 无占位）', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.note', {
          resourceKind: 'artifact',
          representation: {
            kind: 'structured',
            mimeType: 'application/json',
            byteSize: null,
          },
          allowedActions: ['view', 'edit', 'regenerate'],
        }),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('rendererId_not_registered');
      }
    });

    it('artifact.audio-overview 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.audio-overview', {
          resourceKind: 'artifact',
          representation: {
            kind: 'audio',
            mimeType: 'audio/mpeg',
            byteSize: null,
          },
          trustTier: 'tier2',
          allowedActions: ['view', 'download', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });

    it('artifact.generated-image 选择正确 Renderer', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.generated-image', {
          resourceKind: 'artifact',
          representation: {
            kind: 'image',
            mimeType: 'image/png',
            byteSize: null,
          },
          trustTier: 'tier2',
          allowedActions: ['view', 'download', 'delete'],
        }),
      );
      expect(result.kind).toBe('available');
    });
  });

  describe('不兼容组合返回 unavailable', () => {
    it('未注册的 rendererId 返回 rendererId_not_registered', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('unknown.renderer'),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('rendererId_not_registered');
      }
    });

    it('rendererVersion 不匹配返回 rendererVersion_mismatch', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.pdf', {
          renderer: { rendererId: 'source.pdf', rendererVersion: 999 },
        }),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('rendererVersion_mismatch');
      }
    });

    it('representation 不匹配返回 representation_not_supported', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.pdf', {
          representation: {
            kind: 'audio',
            mimeType: 'audio/mpeg',
            byteSize: null,
          },
        }),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('representation_not_supported');
      }
    });

    it('trustTier 不匹配返回 trustTier_not_supported', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.pdf', {
          trustTier: 'tier3',
        }),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('trustTier_not_supported');
      }
    });

    it('runtimeKind 不匹配返回 runtimeKind_not_supported', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('artifact.generated-image', {
          representation: {
            kind: 'image',
            mimeType: 'image/png',
            byteSize: null,
          },
          trustTier: 'tier2',
          runtime: {
            kind: 'experiment',
            protocolVersion: 1,
            maxDurationMs: 1000,
            maxOutputBytes: 1024,
            network: 'none',
          },
        }),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('runtimeKind_not_supported');
      }
    });

    it('allowedActions 不支持返回 action_not_supported', () => {
      const result = selectWebCanvasResourceRenderer(
        makeResource('source.pdf', {
          allowedActions: ['view', 'edit'],
        }),
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toBe('action_not_supported');
      }
    });
  });
});
