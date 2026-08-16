import { describe, expect, it, vi } from 'vitest';
import {
  createResultOpener,
  mapDesktopTargetToGatewayTarget,
} from '../src/main/result-opener';
import type { StoredDesktopSession } from '../src/main/desktop-session-store';
import { isDesktopResultTarget } from '../src/shared/result-action';

const session: StoredDesktopSession = {
  version: 2,
  token: `ecs1_${'t'.repeat(43)}`,
  expiresAt: '2026-09-10T08:00:00.000Z',
  webBaseUrl: 'https://learn.educanvas.example',
  gatewayBaseUrl: 'https://gateway.educanvas.example',
  userId: 'user:one',
  initialCursor: null,
};

describe('desktop result opener', () => {
  it('rejects arbitrary URLs at the renderer IPC boundary', () => {
    expect(
      isDesktopResultTarget({
        kind: 'web',
        assetId: 'asset:one',
        assetVersionId: 'version:one',
        url: 'javascript:alert(1)',
      }),
    ).toBe(false);
    expect(
      isDesktopResultTarget({
        kind: 'web',
        assetId: 'asset:one',
        assetVersionId: 'version:one',
        url: 'https://example.edu/source',
      }),
    ).toBe(true);
  });

  it('opens an opaque, one-time handoff for the current conversation', async () => {
    const openExternal = vi.fn(async () => undefined);
    const issueHandoff = vi.fn(async () => ({ token: 'x'.repeat(43) }));
    const opener = createResultOpener({
      getSession: async () => session,
      currentConversationId: () => 'conversation:one',
      issueHandoff,
      readImagePreview: vi.fn(),
      openExternal,
    });

    await expect(opener.open()).resolves.toEqual({ ok: true });
    expect(issueHandoff).toHaveBeenCalledWith(
      session,
      'conversation:one',
      null,
    );
    expect(openExternal).toHaveBeenCalledWith(
      `https://learn.educanvas.example/open?token=${'x'.repeat(43)}`,
    );
  });

  it('sinks an artifact target into the one-time credential', async () => {
    const openExternal = vi.fn(async () => undefined);
    const issueHandoff = vi.fn(async () => ({ token: 'x'.repeat(43) }));
    const opener = createResultOpener({
      getSession: async () => session,
      currentConversationId: () => 'conversation:one',
      issueHandoff,
      readImagePreview: vi.fn(),
      openExternal,
    });

    const artifactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      opener.open({
        kind: 'artifact',
        artifactId,
        versionId: null,
      }),
    ).resolves.toEqual({ ok: true });
    expect(issueHandoff).toHaveBeenCalledWith(session, 'conversation:one', {
      kind: 'artifact',
      artifactId,
      versionId: null,
    });
  });

  it('maps asset and web targets to a source resource target', () => {
    const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(
      mapDesktopTargetToGatewayTarget({
        kind: 'asset',
        assetId,
        assetVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toEqual({
      kind: 'resource',
      resourceKind: 'source',
      resourceId: assetId,
      versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(
      mapDesktopTargetToGatewayTarget({
        kind: 'web',
        assetId,
        assetVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        url: 'https://example.edu/source',
      }),
    ).toEqual({
      kind: 'resource',
      resourceKind: 'source',
      resourceId: assetId,
      versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    // knowledge 与空 target 一律回落到 conversation 级（null）。
    expect(
      mapDesktopTargetToGatewayTarget({
        kind: 'knowledge',
        sourceId: 'source:1',
        documentId: 'doc:1',
        chunkId: 'chunk:1',
        pageStart: null,
        pageEnd: null,
      }),
    ).toBeNull();
    expect(mapDesktopTargetToGatewayTarget(null)).toBeNull();
  });

  it('returns a bounded image data URL without exposing the storage location', async () => {
    const readImagePreview = vi.fn(async () => ({
      mimeType: 'image/png' as const,
      bytes: Uint8Array.from([137, 80, 78, 71]),
    }));
    const opener = createResultOpener({
      getSession: async () => session,
      currentConversationId: () => 'conversation:one',
      issueHandoff: vi.fn(),
      readImagePreview,
      openExternal: vi.fn(),
    });

    await expect(
      opener.preview({
        kind: 'asset',
        assetId: 'asset:one',
        assetVersionId: 'version:one',
      }),
    ).resolves.toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,iVBORw==',
    });
    expect(readImagePreview).toHaveBeenCalledWith(session, 'conversation:one', {
      kind: 'asset',
      assetId: 'asset:one',
      assetVersionId: 'version:one',
    });
  });

  it('does not open a browser without an authenticated current conversation', async () => {
    const openExternal = vi.fn(async () => undefined);
    const opener = createResultOpener({
      getSession: async () => null,
      currentConversationId: () => null,
      issueHandoff: vi.fn(),
      readImagePreview: vi.fn(),
      openExternal,
    });

    await expect(opener.open()).resolves.toEqual({
      ok: false,
      message: '请先登录并选择一个对话。',
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('keeps gateway and browser failures inside a stable renderer result', async () => {
    const opener = createResultOpener({
      getSession: async () => session,
      currentConversationId: () => 'conversation:one',
      issueHandoff: async () => {
        throw new Error('private gateway detail');
      },
      readImagePreview: vi.fn(),
      openExternal: vi.fn(),
    });

    await expect(opener.open()).resolves.toEqual({
      ok: false,
      message: '暂时无法打开，请稍后重试。',
    });
  });
});
