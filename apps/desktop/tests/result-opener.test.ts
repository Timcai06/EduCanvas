import { describe, expect, it, vi } from 'vitest';
import { createResultOpener } from '../src/main/result-opener';
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
      openExternal,
    });

    await expect(opener.open()).resolves.toEqual({ ok: true });
    expect(issueHandoff).toHaveBeenCalledWith(session, 'conversation:one');
    expect(openExternal).toHaveBeenCalledWith(
      `https://learn.educanvas.example/open?token=${'x'.repeat(43)}`,
    );
  });

  it('does not open a browser without an authenticated current conversation', async () => {
    const openExternal = vi.fn(async () => undefined);
    const opener = createResultOpener({
      getSession: async () => null,
      currentConversationId: () => null,
      issueHandoff: vi.fn(),
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
      openExternal: vi.fn(),
    });

    await expect(opener.open()).resolves.toEqual({
      ok: false,
      message: '暂时无法打开，请稍后重试。',
    });
  });
});
