import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { issueVoiceStreamingTicket } from './voice-gateway-client';

describe('issueVoiceStreamingTicket', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('服务端 bootstrap 后换取 ticket，长时 bearer 不返回浏览器', async () => {
    const calls: Array<{ url: string; authorization: string; body: unknown }> =
      [];
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        calls.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization') ?? '',
          body: JSON.parse(String(init?.body)) as unknown,
        });
        return calls.length === 1
          ? Response.json({
              userId: 'user:1',
              agentId: 'agent:1',
              token: 'session-token',
              expiresAt: '2026-08-11T00:00:00.000Z',
            })
          : Response.json(
              {
                ticket: 'short-ticket',
                expiresAt: '2026-08-10T00:01:00.000Z',
              },
              { status: 201 },
            );
      },
    ) as typeof fetch;
    const result = await issueVoiceStreamingTicket(
      { subjectUserId: 'user:1', notebookId: 'notebook:1' },
      {
        env: {
          NODE_ENV: 'test',
          EDUCANVAS_GATEWAY_URL: 'http://127.0.0.1:3200',
          EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: 's'.repeat(32),
        },
        fetchImpl,
      },
    );
    expect(result).toEqual({
      ticket: 'short-ticket',
      expiresAt: '2026-08-10T00:01:00.000Z',
    });
    expect(calls[0]).toMatchObject({
      authorization: `Bearer ${'s'.repeat(32)}`,
      body: { userId: 'user:1' },
    });
    expect(calls[1]).toMatchObject({
      authorization: 'Bearer session-token',
      body: { notebookId: 'notebook:1' },
    });
    expect(JSON.stringify(result)).not.toContain('session-token');
  });

  it('缺配置 fail closed，不发请求', async () => {
    const fetchImpl = vi.fn();
    await expect(
      issueVoiceStreamingTicket(
        { subjectUserId: 'user:1', notebookId: 'notebook:1' },
        {
          env: { NODE_ENV: 'test' },
          fetchImpl: fetchImpl as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({
      code: 'VOICE_GATEWAY_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Gateway 回显不同主体时拒绝继续换取 ticket', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        userId: 'user:other',
        agentId: 'agent:other',
        token: 'session-token',
        expiresAt: '2026-08-11T00:00:00.000Z',
      }),
    ) as typeof fetch;
    await expect(
      issueVoiceStreamingTicket(
        { subjectUserId: 'user:1', notebookId: 'notebook:1' },
        {
          env: {
            NODE_ENV: 'test',
            EDUCANVAS_GATEWAY_URL: 'http://127.0.0.1:3200',
            EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: 's'.repeat(32),
          },
          fetchImpl,
        },
      ),
    ).rejects.toMatchObject({ code: 'VOICE_GATEWAY_REJECTED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('保留 Gateway 统一的资源不存在语义且不读取或暴露响应体', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? Response.json({
            userId: 'user:1',
            agentId: 'agent:1',
            token: 'session-token',
            expiresAt: '2026-08-11T00:00:00.000Z',
          })
        : Response.json(
            { error: { code: 'NOT_FOUND', privateDetail: 'must-not-escape' } },
            { status: 404 },
          );
    }) as typeof fetch;

    await expect(
      issueVoiceStreamingTicket(
        { subjectUserId: 'user:1', notebookId: 'notebook:other' },
        {
          env: {
            NODE_ENV: 'test',
            EDUCANVAS_GATEWAY_URL: 'http://127.0.0.1:3200',
            EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: 's'.repeat(32),
          },
          fetchImpl,
        },
      ),
    ).rejects.toMatchObject({ code: 'VOICE_GATEWAY_RESOURCE_NOT_FOUND' });
  });

  it('bootstrap 路由缺失仍归类为 Gateway 拒绝而非 Notebook 不可访问', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
    ) as typeof fetch;

    await expect(
      issueVoiceStreamingTicket(
        { subjectUserId: 'user:1', notebookId: 'notebook:1' },
        {
          env: {
            NODE_ENV: 'test',
            EDUCANVAS_GATEWAY_URL: 'http://127.0.0.1:3200',
            EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: 's'.repeat(32),
          },
          fetchImpl,
        },
      ),
    ).rejects.toMatchObject({ code: 'VOICE_GATEWAY_REJECTED' });
  });

  it('默认服务端路径在安全窗口内复用同一主体的短期 Gateway grant', async () => {
    vi.stubEnv('EDUCANVAS_GATEWAY_URL', 'http://127.0.0.1:3299');
    vi.stubEnv('EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN', 's'.repeat(32));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        calls.push(url);
        return url.endsWith('/v1/client/bootstrap')
          ? Response.json({
              userId: 'user:cache-test',
              token: 'cached-session-token',
              expiresAt: '2099-08-11T00:00:00.000Z',
            })
          : Response.json(
              {
                ticket: `ticket-${calls.length}`,
                expiresAt: '2099-08-11T00:01:00.000Z',
              },
              { status: 201 },
            );
      }),
    );

    await issueVoiceStreamingTicket({
      subjectUserId: 'user:cache-test',
      notebookId: 'notebook:1',
    });
    await issueVoiceStreamingTicket({
      subjectUserId: 'user:cache-test',
      notebookId: 'notebook:2',
    });

    expect(
      calls.filter((url) => url.endsWith('/v1/client/bootstrap')),
    ).toHaveLength(1);
    expect(
      calls.filter((url) =>
        url.endsWith('/v1/client/streaming-transcription/tickets'),
      ),
    ).toHaveLength(2);
  });
});
