import type { CanvasResource } from '@educanvas/canvas-protocol';
import React, { type ComponentType } from 'react';
import type { CanvasResourceRendererProps } from './canvas-resource-registry';

export const SourceRenderer: ComponentType<CanvasResourceRendererProps> = () =>
  null;

export const ArtifactRenderer: ComponentType<
  CanvasResourceRendererProps
> = () => null;

export const PropsAwareRenderer: ComponentType<CanvasResourceRendererProps> = ({
  resource,
}) => React.createElement('span', null, resource.title);

export function sourceResource(
  overrides: Partial<CanvasResource['renderer']> = {},
): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'src-1',
    notebookId: 'nb-1',
    resourceKind: 'source',
    title: 'Test Source',
    status: 'ready',
    version: {
      versionId: 'v-1',
      sequence: null,
      checksum: null,
    },
    representation: {
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 1000,
    },
    renderer: {
      rendererId: 'edu.source.pdf',
      rendererVersion: 1,
      ...overrides,
    },
    trustTier: 'tier1',
    allowedActions: ['view', 'download'],
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
  };
}

export function artifactResource(
  overrides: Partial<CanvasResource['renderer']> = {},
): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'art-1',
    notebookId: 'nb-1',
    resourceKind: 'artifact',
    title: 'Test Artifact',
    status: 'ready',
    version: {
      versionId: 'v-1',
      sequence: 1,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'structured',
      mimeType: 'application/json',
      byteSize: 500,
    },
    renderer: {
      rendererId: 'edu.artifact.quiz',
      rendererVersion: 2,
      ...overrides,
    },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'agent_generated',
      createdBy: 'agent',
      createdAt: '2026-07-28T00:00:00.000Z',
      sourceResourceIds: ['src-1'],
      operationId: 'op-1',
      generator: null,
    },
    runtime: { kind: 'none' },
  };
}
