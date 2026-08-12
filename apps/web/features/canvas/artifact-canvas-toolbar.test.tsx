import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactDetail } from './artifact-client';
import type { CanvasResourceAction } from '@educanvas/canvas-protocol';
import { ArtifactCanvasToolbar } from './artifact-canvas-toolbar';

function makeDetail(
  latestVersion: number,
  versions: number[],
  allowedActions: readonly CanvasResourceAction[] = ['view'],
  kind = 'note',
): ArtifactDetail {
  return {
    artifact: {
      id: 'art-restore-1',
      kind,
      trustTier: 'tier1',
      title: '课程文档',
      status: 'active',
      latestVersion,
      fromConversation: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
    },
    version: {
      id: 'v-1',
      version: latestVersion,
      content: null,
      media: null,
    },
    versions: versions.map((version) => ({
      version,
      generatedBy: null,
      revisionInstruction: null,
      createdAt: '2026-01-01T00:00:00Z',
    })),
    latestJob: null,
    canvasResource: {
      schemaVersion: 1,
      resourceId: 'art-1',
      notebookId: 'nb-1',
      resourceKind: 'artifact',
      title: '课程文档',
      status: 'ready',
      version: { versionId: 'v-1', sequence: 1, checksum: 'a'.repeat(64) },
      representation: {
        kind: 'structured',
        mimeType: 'application/json',
        byteSize: null,
      },
      renderer: {
        rendererId: 'artifact.markdown-document',
        rendererVersion: 1,
      },
      trustTier: 'tier1',
      allowedActions: [...allowedActions],
      canProduceCandidateLearningEvents: false,
      provenance: {
        origin: 'agent_generated',
        createdBy: 'agent',
        createdAt: '2026-01-01T00:00:00+08:00',
        sourceResourceIds: [],
        operationId: null,
        generator: null,
      },
      runtime: { kind: 'none' },
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ArtifactCanvasToolbar', () => {
  function renderHtml(overrides: {
    latestVersion: number;
    versions: number[];
    allowedActions?: readonly CanvasResourceAction[];
    kind?: string;
    displayedVersion?: number;
    onRestored?: () => void;
    onDeleted?: () => void;
    onSelectVersion?: () => void;
  }) {
    const detail = makeDetail(
      overrides.latestVersion,
      overrides.versions,
      overrides.allowedActions ?? ['view'],
      overrides.kind,
    );
    return renderToStaticMarkup(
      <ArtifactCanvasToolbar
        detail={detail}
        displayedVersion={overrides.displayedVersion ?? 1}
        onSelectVersion={overrides.onSelectVersion ?? (() => {})}
        onDeleted={overrides.onDeleted ?? (() => {})}
        onRestored={overrides.onRestored ?? (() => {})}
      />,
    );
  }

  it('shows restore button on historical version', () => {
    const html = renderHtml({
      latestVersion: 2,
      versions: [1, 2],
      allowedActions: ['view', 'edit', 'regenerate', 'download'],
      displayedVersion: 1,
      kind: 'markdown_document',
    });

    expect(html).toContain('恢复为新版本');
  });

  it('does not show restore for latest version', () => {
    const html = renderHtml({
      latestVersion: 1,
      versions: [1],
      allowedActions: ['view', 'edit', 'regenerate'],
      displayedVersion: 1,
    });
    expect(html).not.toContain('恢复为新版本');
  });

  it('does not show restore without edit/regenerate action', () => {
    const html = renderHtml({
      latestVersion: 2,
      versions: [1, 2],
      allowedActions: ['view', 'download'],
      displayedVersion: 1,
    });
    expect(html).not.toContain('恢复为新版本');
  });

  it('shows download link only when download action exists', () => {
    const html = renderHtml({
      latestVersion: 2,
      versions: [1, 2],
      allowedActions: ['view', 'download', 'edit'],
      displayedVersion: 1,
    });
    expect(html).toContain(
      'href="/api/v1/chat/artifacts/art-restore-1/download?version=1"',
    );
  });

  it('does not show download link without download action', () => {
    const html = renderHtml({
      latestVersion: 2,
      versions: [1, 2],
      allowedActions: ['view', 'edit'],
      displayedVersion: 1,
    });
    const link = html.includes(
      'href="/api/v1/chat/artifacts/art-restore-1/download?version=1"',
    );
    expect(link).toBe(false);
  });
});
