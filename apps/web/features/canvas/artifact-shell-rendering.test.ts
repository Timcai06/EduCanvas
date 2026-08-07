import { describe, expect, it } from 'vitest';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import {
  isShellRenderedArtifactResource,
  SHELL_RENDERED_ARTIFACT_RENDERER_IDS,
} from './artifact-shell-rendering';

function makeResource(
  rendererId: string,
  resourceKind: 'source' | 'artifact' = 'artifact',
): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'aaaa0000-0000-4000-8000-000000000001',
    notebookId: 'bbbb0000-0000-4000-8000-000000000001',
    resourceKind,
    title: '测试产物',
    status: 'ready',
    version: {
      versionId: 'cccc0000-0000-4000-8000-000000000001',
      sequence: 1,
      checksum: null,
    },
    representation: {
      kind: 'structured',
      mimeType: 'application/json',
      byteSize: null,
    },
    renderer: { rendererId, rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'agent_generated',
      createdBy: 'agent',
      createdAt: '2026-07-27T00:00:00+08:00',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
  };
}

/**
 * W04-4 回归防护：Studio 打开验证须放行由壳渲染的交互式产物。
 * Registry 不承载 note/dom_exploration 条目，但这两类 Artifact 由
 * ArtifactCanvas 壳显式渲染，不能被判为"没有可用的渲染器"。
 */
describe('isShellRenderedArtifactResource', () => {
  it('壳渲染集合只含 note 与 dom_exploration', () => {
    expect([...SHELL_RENDERED_ARTIFACT_RENDERER_IDS].sort()).toEqual([
      'artifact.dom-exploration',
      'artifact.note',
    ]);
  });

  it('note → true（壳渲染，Registry 无条目）', () => {
    expect(isShellRenderedArtifactResource(makeResource('artifact.note'))).toBe(
      true,
    );
  });

  it('dom_exploration → true（壳渲染，Registry 无条目）', () => {
    expect(
      isShellRenderedArtifactResource(makeResource('artifact.dom-exploration')),
    ).toBe(true);
  });

  it('5 类内容驱动 Artifact → false（走 Registry）', () => {
    for (const rendererId of [
      'artifact.mind-map',
      'artifact.slides',
      'artifact.flashcards',
      'artifact.audio-overview',
      'artifact.generated-image',
    ]) {
      expect(isShellRenderedArtifactResource(makeResource(rendererId))).toBe(
        false,
      );
    }
  });

  it('Source 即使 rendererId 巧合也不是壳渲染产物', () => {
    expect(
      isShellRenderedArtifactResource(
        makeResource('artifact.note', 'source'),
      ),
    ).toBe(false);
  });

  it('未知 rendererId → false', () => {
    expect(isShellRenderedArtifactResource(makeResource('unknown.renderer'))).toBe(
      false,
    );
  });
});
