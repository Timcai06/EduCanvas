import { describe, expect, it } from 'vitest';
import { GatewayBootstrapClient, GatewayClient } from './client';

describe('GatewayClient', () => {
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
