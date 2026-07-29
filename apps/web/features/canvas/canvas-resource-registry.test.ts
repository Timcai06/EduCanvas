import { describe, expect, it } from 'vitest';
import type {
  CanvasRendererManifest,
  CanvasResource,
} from '@educanvas/canvas-protocol';
import type { ComponentType } from 'react';
import {
  createCanvasResourceRegistry,
  selectCanvasResourceRenderer,
  type CanvasResourceRendererProps,
} from './canvas-resource-registry';
import {
  ArtifactRenderer,
  SourceRenderer,
  artifactResource,
  sourceResource,
} from './canvas-resource-registry.test-fixtures';

describe('selectCanvasResourceRenderer', () => {
  const sourceRegistry = createCanvasResourceRegistry([
    {
      manifest: {
        manifestVersion: 1,
        rendererId: 'edu.source.pdf',
        rendererVersion: 1,
        representations: ['document'],
        trustTiers: ['tier1'],
        runtimeKinds: ['none'],
        supportedActions: ['view', 'download'],
      },
      Renderer: SourceRenderer,
    },
  ]);

  const artifactRegistry = createCanvasResourceRegistry([
    {
      manifest: {
        manifestVersion: 1,
        rendererId: 'edu.artifact.quiz',
        rendererVersion: 2,
        representations: ['structured'],
        trustTiers: ['tier1'],
        runtimeKinds: ['none'],
        supportedActions: ['view'],
      },
      Renderer: ArtifactRenderer,
    },
  ]);

  it('selects the correct Renderer for a source resource', () => {
    const result = selectCanvasResourceRenderer(
      sourceRegistry,
      sourceResource(),
    );
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      expect(result.Renderer).toBe(SourceRenderer);
    }
  });

  it('selects the correct Renderer for an artifact resource', () => {
    const result = selectCanvasResourceRenderer(
      artifactRegistry,
      artifactResource(),
    );
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      expect(result.Renderer).toBe(ArtifactRenderer);
    }
  });

  it('returns unavailable for unknown rendererId', () => {
    const result = selectCanvasResourceRenderer(
      sourceRegistry,
      sourceResource({ rendererId: 'unknown.renderer' }),
    );
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('rendererId_not_registered');
    }
  });

  it('returns unavailable for mismatched rendererVersion', () => {
    const result = selectCanvasResourceRenderer(
      sourceRegistry,
      sourceResource({ rendererVersion: 99 }),
    );
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('rendererVersion_mismatch');
    }
  });

  it('returns unavailable for unsupported representation', () => {
    const resource = sourceResource();
    resource.representation = {
      kind: 'audio',
      mimeType: 'audio/wav',
      byteSize: 0,
    } as CanvasResource['representation'];
    const res = selectCanvasResourceRenderer(sourceRegistry, resource);
    expect(res.kind).toBe('unavailable');
    if (res.kind === 'unavailable') {
      expect(res.reason).toBe('representation_not_supported');
    }
  });

  it('returns unsupported trustTier as unavailable', () => {
    const tier2Registry = createCanvasResourceRegistry([
      {
        manifest: {
          manifestVersion: 1,
          rendererId: 'edu.source.pdf',
          rendererVersion: 1,
          representations: ['document'],
          trustTiers: ['tier2'],
          runtimeKinds: ['none'],
          supportedActions: ['view', 'download'],
        },
        Renderer: SourceRenderer,
      },
    ]);
    const result = selectCanvasResourceRenderer(
      tier2Registry,
      sourceResource(),
    );
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('trustTier_not_supported');
    }
  });

  it('returns unsupported runtime.kind as unavailable', () => {
    const sandboxRegistry = createCanvasResourceRegistry([
      {
        manifest: {
          manifestVersion: 1,
          rendererId: 'edu.source.pdf',
          rendererVersion: 1,
          representations: ['document'],
          trustTiers: ['tier1', 'tier2'],
          runtimeKinds: ['web_sandbox'],
          supportedActions: ['view'],
        },
        Renderer: SourceRenderer,
      },
    ]);
    const result = selectCanvasResourceRenderer(
      sandboxRegistry,
      sourceResource(),
    );
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('runtimeKind_not_supported');
    }
  });

  it('returns unavailable when resource.allowedActions exceeds manifest.supportedActions', () => {
    const limitedRegistry = createCanvasResourceRegistry([
      {
        manifest: {
          manifestVersion: 1,
          rendererId: 'edu.source.pdf',
          rendererVersion: 1,
          representations: ['document'],
          trustTiers: ['tier1'],
          runtimeKinds: ['none'],
          supportedActions: ['view'],
        },
        Renderer: SourceRenderer,
      },
    ]);
    const result = selectCanvasResourceRenderer(
      limitedRegistry,
      sourceResource(),
    );
    // sourceResource() has allowedActions: ['view', 'download'] but manifest only has ['view']
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('action_not_supported');
    }
  });

  it('does not mutate the original manifest or resource', () => {
    const resource = sourceResource();
    const originalRendererId = resource.renderer.rendererId;
    const originalTitle = resource.title;

    selectCanvasResourceRenderer(sourceRegistry, resource);

    expect(resource.renderer.rendererId).toBe(originalRendererId);
    expect(resource.title).toBe(originalTitle);
  });

  it('unavailable result does not contain stack, content, URL, or object storage info', () => {
    const result = selectCanvasResourceRenderer(
      sourceRegistry,
      sourceResource({ rendererId: 'no.such.renderer', rendererVersion: 1 }),
    );
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      const keys = Object.keys(result);
      expect(keys).not.toContain('stack');
      expect(keys).not.toContain('content');
      expect(keys).not.toContain('url');
      expect(keys).not.toContain('storageKey');
      expect(keys).not.toContain('objectKey');
    }
  });

  it('returns the manifest alongside the Renderer when available', () => {
    const result = selectCanvasResourceRenderer(
      sourceRegistry,
      sourceResource(),
    );
    if (result.kind === 'available') {
      expect(result.manifest.rendererId).toBe('edu.source.pdf');
      expect(result.manifest.rendererVersion).toBe(1);
    }
  });

  it('mutations to original manifest do not affect registry after registration', () => {
    const manifest = {
      manifestVersion: 1 as const,
      rendererId: 'edu.source.pdf',
      rendererVersion: 1,
      representations: ['document' as const],
      trustTiers: ['tier1' as const],
      runtimeKinds: ['none' as const],
      supportedActions: ['view' as const],
    };
    const reg = createCanvasResourceRegistry([
      { manifest, Renderer: SourceRenderer },
    ]);

    // Mutate the original manifest after registration.
    manifest.rendererId = 'mutated.renderer';
    manifest.rendererVersion = 999;

    const resource = sourceResource();
    resource.allowedActions = ['view'];
    const result = selectCanvasResourceRenderer(reg, resource);
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      expect(result.manifest.rendererId).toBe('edu.source.pdf');
      expect(result.manifest.rendererVersion).toBe(1);
    }
  });

  it('mutations to registrations array do not affect registry after creation', () => {
    const entries: {
      manifest: CanvasRendererManifest;
      Renderer: ComponentType<CanvasResourceRendererProps>;
    }[] = [
      {
        manifest: {
          manifestVersion: 1 as const,
          rendererId: 'edu.source.pdf',
          rendererVersion: 1,
          representations: ['document' as const],
          trustTiers: ['tier1' as const],
          runtimeKinds: ['none' as const],
          supportedActions: ['view' as const],
        },
        Renderer: SourceRenderer,
      },
    ];
    const reg = createCanvasResourceRegistry(entries);

    // Mutate the original array after registry creation.
    entries.push({
      manifest: {
        manifestVersion: 1,
        rendererId: 'mutated.renderer',
        rendererVersion: 999,
        representations: ['audio'],
        trustTiers: ['tier2'],
        runtimeKinds: ['web_sandbox'],
        supportedActions: ['view'],
      },
      Renderer: ArtifactRenderer,
    });

    const resource = sourceResource();
    resource.allowedActions = ['view'];
    const result = selectCanvasResourceRenderer(reg, resource);
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      expect(result.manifest.rendererId).toBe('edu.source.pdf');
    }
  });

  it('available manifest cannot pollute registry internal state', () => {
    const reg = createCanvasResourceRegistry([
      {
        manifest: {
          manifestVersion: 1,
          rendererId: 'edu.source.pdf',
          rendererVersion: 1,
          representations: ['document'],
          trustTiers: ['tier1'],
          runtimeKinds: ['none'],
          supportedActions: ['view'],
        },
        Renderer: SourceRenderer,
      },
    ]);

    const resource = sourceResource();
    resource.allowedActions = ['view'];
    const result = selectCanvasResourceRenderer(reg, resource);
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      // Mutate the returned manifest snapshot.
      result.manifest.rendererId = 'polluted';
      result.manifest.rendererVersion = 999;
    }

    // Second selection must still return the original, unmutated manifest.
    const second = selectCanvasResourceRenderer(reg, resource);
    expect(second.kind).toBe('available');
    if (second.kind === 'available') {
      expect(second.manifest.rendererId).toBe('edu.source.pdf');
      expect(second.manifest.rendererVersion).toBe(1);
    }
  });
});
