import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import {
  createCanvasResourceRegistry,
  selectCanvasResourceRenderer,
  type CanvasResourceRendererProps,
} from './canvas-resource-registry';
import {
  ArtifactRenderer,
  PropsAwareRenderer,
  SourceRenderer,
  sourceResource,
} from './canvas-resource-registry.test-fixtures';

describe('createCanvasResourceRegistry', () => {
  it('accepts valid registrations', () => {
    const registry = createCanvasResourceRegistry([
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
    expect(registry.size).toBe(1);
  });

  it('registers a function Renderer that receives resource props', () => {
    const registry = createCanvasResourceRegistry([
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
        Renderer: PropsAwareRenderer,
      },
    ]);
    const result = selectCanvasResourceRenderer(registry, sourceResource());
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      expect(result.Renderer).toBe(PropsAwareRenderer);
    }
  });

  it('throws on duplicate rendererId + rendererVersion', () => {
    const manifest = {
      manifestVersion: 1 as const,
      rendererId: 'edu.source.pdf',
      rendererVersion: 1,
      representations: ['document' as const],
      trustTiers: ['tier1' as const],
      runtimeKinds: ['none' as const],
      supportedActions: ['view' as const],
    };
    expect(() =>
      createCanvasResourceRegistry([
        { manifest, Renderer: SourceRenderer },
        { manifest, Renderer: ArtifactRenderer },
      ]),
    ).toThrow();
  });

  it('rejects invalid manifest via schema validation', () => {
    expect(() =>
      createCanvasResourceRegistry([
        { manifest: {} as never, Renderer: SourceRenderer },
      ]),
    ).toThrow();
  });

  it('rejects a string Renderer cast through type assertion', () => {
    expect(() =>
      createCanvasResourceRegistry([
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
          Renderer:
            'not-a-component' as unknown as ComponentType<CanvasResourceRendererProps>,
        },
      ]),
    ).toThrow('Renderer must be a local function component reference');
  });

  it('rejects a Promise cast through type assertion', () => {
    expect(() =>
      createCanvasResourceRegistry([
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
          Renderer:
            Promise.resolve() as unknown as ComponentType<CanvasResourceRendererProps>,
        },
      ]),
    ).toThrow('Renderer must be a local function component reference');
  });

  it('does not mutate the input registration array', () => {
    const entry = {
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
    };
    const arr = [entry];
    const originalManifest = { ...entry.manifest };
    createCanvasResourceRegistry(arr);
    expect(arr).toHaveLength(1);
    expect(arr[0]).toBe(entry);
    expect(entry.manifest).toEqual(originalManifest);
  });
});

describe('registry immutability boundary', () => {
  const registry = createCanvasResourceRegistry([
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

  it('registry handle is frozen', () => {
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('does not expose get, has, or keys', () => {
    const handle = registry as unknown as Record<string, unknown>;
    expect(handle.get).toBeUndefined();
    expect(handle.has).toBeUndefined();
    expect(handle.keys).toBeUndefined();
  });

  it('does not expose set, delete, or clear', () => {
    const handle = registry as unknown as Record<string, unknown>;
    expect(handle.set).toBeUndefined();
    expect(handle.delete).toBeUndefined();
    expect(handle.clear).toBeUndefined();
  });

  it('cannot inject a Renderer via property override on the handle', () => {
    const fakeRenderer: ComponentType<CanvasResourceRendererProps> = () => null;
    expect(() => {
      (registry as unknown as Record<string, unknown>).get = () => ({
        manifest: {
          manifestVersion: 1,
          rendererId: 'injected.renderer',
          rendererVersion: 1,
          representations: ['document'],
          trustTiers: ['tier1'],
          runtimeKinds: ['none'],
          supportedActions: ['view'],
        },
        Renderer: fakeRenderer,
      });
    }).toThrow();

    const result = selectCanvasResourceRenderer(
      registry,
      sourceResource({ rendererId: 'injected.renderer' }),
    );
    expect(result.kind).toBe('unavailable');
  });

  it('cannot obtain and mutate a real InternalEntry', () => {
    const resource = sourceResource();
    resource.allowedActions = ['view'];
    const first = selectCanvasResourceRenderer(registry, resource);
    expect(first.kind).toBe('available');

    const handle = registry as unknown as Record<string, unknown>;
    expect(handle.entries).toBeUndefined();
    expect(handle['#entries']).toBeUndefined();
  });
});
