import { describe, expect, it } from 'vitest';
import { GatewayBootstrapClient, GatewayClient } from './client';

describe('GatewayClient', () => {
  it('uses the loopback onboarding endpoint without sending a user id', async () => {
    let seenBody: BodyInit | null | undefined;
    const session = await new GatewayBootstrapClient(
      'http://127.0.0.1:3200',
      async (_url, init) => {
        seenBody = init?.body;
        return Response.json({
          userId: 'local:owner',
          agentId: 'agent:local',
          token: 't'.repeat(32),
          expiresAt: '2026-07-20T04:00:00.000Z',
        });
      },
    ).onboardLocal();
    expect(session.userId).toBe('local:owner');
    expect(seenBody).toBeUndefined();
  });

  it('bootstraps without placing credentials in the URL', async () => {
    let seen = '';
    const fetcher: typeof fetch = async (input, init) => {
      seen = String(input);
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer secret-token',
      });
      return Response.json({
        userId: 'user:1',
        agentId: 'agent:1',
        token: 't'.repeat(32),
        expiresAt: '2026-07-20T04:00:00.000Z',
      });
    };
    await new GatewayBootstrapClient(
      'http://127.0.0.1:3200',
      fetcher,
    ).bootstrap('user:1', 'secret-token');
    expect(seen).not.toContain('secret-token');
  });

  it('cancels an operation without double-consuming the response body', async () => {
    /* 回归:此前在 json() 之后又 body.cancel() 会抛 ERR_INVALID_STATE。
       用真实 Response(非纯 mock)才能暴露流锁定。 */
    let seenUrl = '';
    let seenMethod = '';
    const fetcher: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenMethod = init?.method ?? 'GET';
      return Response.json({ status: 'cancelling' });
    };
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      fetcher,
    );
    const result = await client.cancelOperation('operation-1');
    expect(result).toEqual({ status: 'cancelling' });
    expect(seenMethod).toBe('POST');
    expect(seenUrl).toContain('/operations/operation-1/cancel');
  });

  it('lists recent operations for the session', async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({
        operations: [
          {
            operationId: 'operation:1',
            conversationId: 'conversation:1',
            conversationTitle: '分数运算',
            status: 'completed',
            createdAt: '2026-07-20T04:00:00.000Z',
          },
        ],
      });
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      fetcher,
    );
    const operations = await client.listOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operationId: 'operation:1',
      status: 'completed',
    });
  });

  it('creates a handoff without putting the conversation or session in the URL', async () => {
    let seenUrl = '';
    let seenBody = '';
    const fetcher: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenBody = String(init?.body ?? '');
      expect(init?.headers).toMatchObject({
        authorization: `Bearer ${'t'.repeat(32)}`,
      });
      return Response.json(
        {
          token: 'h'.repeat(43),
          expiresAt: '2026-07-21T08:02:00.000Z',
        },
        { status: 201 },
      );
    };
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      fetcher,
    );
    expect(await client.createHandoff('conversation:1')).toMatchObject({
      token: 'h'.repeat(43),
    });
    expect(seenUrl).toBe('http://127.0.0.1:3200/v1/client/handoffs');
    expect(seenUrl).not.toContain('conversation:1');
    expect(seenUrl).not.toContain('t'.repeat(32));
    expect(JSON.parse(seenBody)).toEqual({ conversationId: 'conversation:1' });
  });

  it('manages provider-neutral connections through authenticated client routes', async () => {
    const seen: string[] = [];
    const connection = {
      connectionId: 'connection:1',
      provider: 'telegram',
      status: 'pending',
      conversationId: 'conversation:1',
      createdAt: '2026-07-21T08:00:00.000Z',
      activationExpiresAt: '2026-07-21T08:10:00.000Z',
      revokedAt: null,
    };
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/connections')) {
        return Response.json({ providers: [], connections: [connection] });
      }
      if (url.endsWith('/connect')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          provider: 'telegram',
          conversationId: 'conversation:1',
        });
        return Response.json(
          {
            connection,
            authorization: {
              kind: 'external_url',
              url: 'https://t.me/EduCanvasTutorBot?start=educanvas_connection',
              expiresAt: '2026-07-21T08:10:00.000Z',
            },
          },
          { status: 201 },
        );
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        connectionId: 'connection:1',
      });
      return Response.json({
        connection: {
          ...connection,
          status: 'revoked',
          activationExpiresAt: null,
          revokedAt: '2026-07-21T08:01:00.000Z',
        },
      });
    };
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      fetcher,
    );
    expect((await client.listConnections()).connections).toHaveLength(1);
    expect(await client.connect('telegram', 'conversation:1')).toMatchObject({
      connection: { status: 'pending' },
    });
    expect(await client.revokeConnection('connection:1')).toMatchObject({
      connection: { status: 'revoked' },
    });
    expect(seen.map((entry) => entry.split(' ')[0])).toEqual([
      'GET',
      'POST',
      'POST',
    ]);
  });

  it('parses arbitrarily chunked NDJSON events', async () => {
    const event = JSON.stringify({
      protocol: 'gateway.v1',
      eventId: 'event:1',
      operationId: 'operation:1',
      sequence: 0,
      occurredAt: '2026-07-19T04:00:00.000Z',
      type: 'operation.accepted',
    });
    const fetcher: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(event.slice(0, 20)));
            controller.enqueue(
              new TextEncoder().encode(`${event.slice(20)}\n`),
            );
            controller.close();
          },
        }),
        { status: 200 },
      );
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      fetcher,
    );
    const events = [];
    for await (const item of client.streamTurn({
      clientMessageId: 'message:1',
      notebookId: 'notebook:1',
      conversationId: 'conversation:1',
      parts: [{ type: 'text', text: 'hello' }],
    }))
      events.push(item);
    expect(events).toHaveLength(1);
  });
});
