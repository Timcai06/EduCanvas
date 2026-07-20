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
