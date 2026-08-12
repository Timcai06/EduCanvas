import { describe, expect, it, vi } from 'vitest';
import { createDesktopAuthCoordinator } from '../src/main/desktop-auth-service';
import type { StoredDesktopSession } from '../src/main/desktop-session-store';

const grant = {
  access_token: `ecs1_${'t'.repeat(43)}`,
  token_type: 'Bearer',
  expires_at: '2026-09-10T08:00:00.000Z',
  user_id: 'user:one',
  notebook_id: 'notebook:one',
  conversation_id: 'conversation:one',
};

function harness(overrides?: {
  fetchImpl?: typeof fetch;
  revokeSession?: (session: StoredDesktopSession) => Promise<void>;
  revokeTimeoutMs?: number;
}) {
  let randomFill = 4;
  let stored: StoredDesktopSession | null = null;
  const opened: string[] = [];
  const statuses: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(
    overrides?.fetchImpl ?? (async () => Response.json(grant, { status: 200 })),
  );
  const revoke = vi.fn(overrides?.revokeSession ?? (async () => undefined));
  const coordinator = createDesktopAuthCoordinator({
    webBaseUrl: 'https://learn.educanvas.example',
    gatewayBaseUrl: 'https://gateway.educanvas.example',
    now: () => new Date('2026-08-11T08:00:00.000Z'),
    randomBytes: (size) => Buffer.alloc(size, randomFill++),
    sessionStore: {
      async load() {
        return stored;
      },
      async save(value) {
        stored = value;
      },
      async clear() {
        stored = null;
      },
    },
    async openExternal(url) {
      opened.push(url);
    },
    fetchImpl,
    revokeSession: revoke,
    revokeTimeoutMs: overrides?.revokeTimeoutMs,
    onStatus(status) {
      statuses.push(status.state);
    },
  });
  return {
    coordinator,
    opened,
    statuses,
    fetchImpl,
    revoke,
    stored: () => stored,
  };
}

describe('desktop auth coordinator', () => {
  it('opens the system-browser authorization URL and reports authorizing', async () => {
    const { coordinator, opened, statuses } = harness();
    await expect(coordinator.signIn()).resolves.toEqual({
      state: 'authorizing',
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(
      /^https:\/\/learn\.educanvas\.example\/desktop\/authorize\?/,
    );
    expect(statuses).toContain('authorizing');
  });

  it('validates callback state, exchanges code and persists the bearer', async () => {
    const { coordinator, opened, fetchImpl, stored } = harness();
    await coordinator.signIn();
    const state = new URL(opened[0]!).searchParams.get('state')!;
    const code = `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`;
    await expect(
      coordinator.handleDeepLink(
        `educanvas://auth/callback?code=${code}&state=${state}`,
      ),
    ).resolves.toEqual({ state: 'signed_in' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://learn.educanvas.example/api/v1/desktop-auth/token',
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      code,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(JSON.stringify(body)).not.toContain(state);
    expect(stored()).toMatchObject({
      token: grant.access_token,
      userId: 'user:one',
      notebookId: 'notebook:one',
      conversationId: 'conversation:one',
    });
  });

  it('rejects unsolicited, mismatched and expired callbacks without exchange', async () => {
    const { coordinator, opened, fetchImpl } = harness();
    const code = `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`;
    await expect(
      coordinator.handleDeepLink(
        `educanvas://auth/callback?code=${code}&state=${'s'.repeat(43)}`,
      ),
    ).resolves.toMatchObject({ state: 'error' });
    await coordinator.signIn();
    const state = new URL(opened[0]!).searchParams.get('state')!;
    await expect(
      coordinator.handleDeepLink(
        `educanvas://auth/callback?code=${code}&state=${state.slice(0, -1)}x`,
      ),
    ).resolves.toMatchObject({ state: 'error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('clears local encrypted state and revokes remotely on sign out', async () => {
    const { coordinator, opened, revoke, stored } = harness();
    await coordinator.signIn();
    const state = new URL(opened[0]!).searchParams.get('state')!;
    await coordinator.handleDeepLink(
      `educanvas://auth/callback?code=eca1.${'p'.repeat(48)}.${'x'.repeat(43)}&state=${state}`,
    );
    await expect(coordinator.signOut()).resolves.toEqual({
      state: 'signed_out',
    });
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ token: grant.access_token }),
    );
    expect(stored()).toBeNull();
  });

  it('does not let a stale token exchange sign the user back in after sign out', async () => {
    let finishExchange!: () => void;
    const exchangeReady = new Promise<void>((resolve) => {
      finishExchange = resolve;
    });
    const { coordinator, opened, stored, statuses } = harness({
      fetchImpl: async () => {
        await exchangeReady;
        return Response.json(grant, { status: 200 });
      },
    });
    await coordinator.signIn();
    const state = new URL(opened[0]!).searchParams.get('state')!;
    const exchange = coordinator.handleDeepLink(
      `educanvas://auth/callback?code=eca1.${'p'.repeat(48)}.${'x'.repeat(43)}&state=${state}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await coordinator.signOut();
    finishExchange();

    await expect(exchange).resolves.toEqual({ state: 'signed_out' });
    expect(stored()).toBeNull();
    expect(statuses.at(-1)).toBe('signed_out');
  });

  it('clears local credentials even when remote revocation never responds', async () => {
    const { coordinator, opened, stored } = harness({
      revokeSession: () => new Promise(() => {}),
      revokeTimeoutMs: 5,
    });
    await coordinator.signIn();
    const state = new URL(opened[0]!).searchParams.get('state')!;
    await coordinator.handleDeepLink(
      `educanvas://auth/callback?code=eca1.${'p'.repeat(48)}.${'x'.repeat(43)}&state=${state}`,
    );

    await expect(coordinator.signOut()).resolves.toEqual({
      state: 'signed_out',
    });
    expect(stored()).toBeNull();
  });
});
