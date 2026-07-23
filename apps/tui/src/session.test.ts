import { describe, expect, it, vi } from 'vitest';
import type { TuiSessionConfig } from './config';
import { establishGatewaySession } from './session';

const conversation = {
  notebookId: 'notebook-1',
  conversationId: 'conversation-1',
  title: '我的学习笔记本',
  agentProfileId: 'agent-1',
  membershipRole: 'owner',
} as const;

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TUI Gateway session', () => {
  it('re-onboards a loopback session rejected after a Gateway restart', async () => {
    const saved: TuiSessionConfig[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(401, { error: { code: 'UNAUTHENTICATED' } }),
      )
      .mockResolvedValueOnce(
        response(200, {
          userId: 'local:owner',
          agentId: 'agent-1',
          token: 'n'.repeat(32),
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(response(200, { conversations: [conversation] }));

    const result = await establishGatewaySession('http://127.0.0.1:3200', {
      fetcher,
      loadConfig: async () => ({
        baseUrl: 'http://127.0.0.1:3200',
        userId: 'local:owner',
        token: 'o'.repeat(32),
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      saveConfig: async (config) => {
        saved.push(config);
      },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3200/v1/local/onboard',
      { method: 'POST' },
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.token).toBe('n'.repeat(32));
    expect(result.conversations).toEqual([conversation]);
  });

  it('does not replace a remote authentication failure with local onboarding', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(401, { error: { code: 'UNAUTHENTICATED' } }));

    await expect(
      establishGatewaySession('https://gateway.example.com', {
        fetcher,
        loadConfig: async () => ({
          baseUrl: 'https://gateway.example.com',
          userId: 'user-1',
          token: 'o'.repeat(32),
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
        saveConfig: async () => undefined,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
