import { describe, expect, it } from 'vitest';
import {
  canvasRendererManifestSchema,
  rendererSupportsResource,
  type CanvasRendererManifest,
} from './renderer-manifest';
import type { CanvasResource } from './resource';

const manifest: CanvasRendererManifest = {
  manifestVersion: 1,
  rendererId: 'source.pdf',
  rendererVersion: 1,
  representations: ['document'],
  trustTiers: ['tier1'],
  runtimeKinds: ['none'],
  supportedActions: ['view', 'download', 'annotate'],
};

const resource: CanvasResource = {
  schemaVersion: 1,
  resourceId: 'asset-1',
  notebookId: 'notebook-1',
  resourceKind: 'source',
  title: '函数图像.pdf',
  status: 'ready',
  version: {
    versionId: 'asset-version-1',
    sequence: null,
    checksum: 'a'.repeat(64),
  },
  representation: {
    kind: 'document',
    mimeType: 'application/pdf',
    byteSize: 4_096,
  },
  renderer: {
    rendererId: 'source.pdf',
    rendererVersion: 1,
  },
  trustTier: 'tier1',
  allowedActions: ['view', 'annotate'],
  canProduceCandidateLearningEvents: false,
  provenance: {
    origin: 'upload',
    createdBy: 'user',
    createdAt: '2026-07-25T12:00:00+08:00',
    sourceResourceIds: [],
    operationId: null,
    generator: null,
  },
  runtime: { kind: 'none' },
};

describe('canvasRendererManifestSchema', () => {
  it('接受有界声明且不携带动态组件', () => {
    expect(canvasRendererManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('拒绝重复能力', () => {
    const result = canvasRendererManifestSchema.safeParse({
      ...manifest,
      representations: ['document', 'document'],
    });

    expect(result.success).toBe(false);
  });

  it('拒绝动态URL和额外字段', () => {
    const result = canvasRendererManifestSchema.safeParse({
      ...manifest,
      componentUrl: 'https://example.com/renderer.js',
    });

    expect(result.success).toBe(false);
  });
});

describe('rendererSupportsResource', () => {
  it('确认Renderer覆盖资源要求', () => {
    expect(rendererSupportsResource(manifest, resource)).toBe(true);
  });

  it('拒绝版本不兼容', () => {
    expect(
      rendererSupportsResource({ ...manifest, rendererVersion: 2 }, resource),
    ).toBe(false);
  });

  it('拒绝Renderer未实现的服务端动作', () => {
    expect(
      rendererSupportsResource(
        { ...manifest, supportedActions: ['view'] },
        resource,
      ),
    ).toBe(false);
  });
});
