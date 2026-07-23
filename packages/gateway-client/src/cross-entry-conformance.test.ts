import { describe, expect, it } from 'vitest';
import {
  encodeGatewayConformanceNdjson,
  gatewayCrossEntryConformance,
} from '../../../tooling/test-fixtures/gateway-cross-entry-conformance';
import { GatewayClient } from './client';

describe('GatewayClient跨入口合规', () => {
  it('不失真地消费共享NDJSON且请求体不携带可信身份或Profile', async () => {
    let body: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        encodeGatewayConformanceNdjson(gatewayCrossEntryConformance.completed),
      );
    };
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      fetcher,
    );

    const events = [];
    for await (const event of client.streamTurn(
      gatewayCrossEntryConformance.request,
    )) {
      events.push(event);
    }

    expect(events).toEqual(gatewayCrossEntryConformance.completed);
    expect(Object.keys(body ?? {}).sort()).toEqual([
      'clientMessageId',
      'conversationId',
      'notebookId',
      'parts',
    ]);
    expect(body).not.toHaveProperty('principal');
    expect(body).not.toHaveProperty('agentProfileId');
  });

  it('保留审批等待与取消的零终态/单终态语义', async () => {
    const scripts = [
      gatewayCrossEntryConformance.approvalPending,
      gatewayCrossEntryConformance.cancelled,
    ];
    let index = 0;
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      async () =>
        new Response(encodeGatewayConformanceNdjson(scripts[index++]!)),
    );

    const collected = [];
    for (const script of scripts) {
      const events = [];
      for await (const event of client.streamTurn(
        gatewayCrossEntryConformance.request,
      )) {
        events.push(event);
      }
      collected.push(events);
      expect(events).toEqual(script);
    }

    expect(collected[0]?.at(-1)?.type).toBe('approval.required');
    expect(collected[1]?.at(-1)?.type).toBe('operation.cancelled');
  });
});
