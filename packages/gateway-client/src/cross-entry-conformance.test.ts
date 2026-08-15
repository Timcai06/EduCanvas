import { describe, expect, it } from 'vitest';
import {
  gatewayCapabilityNameSchema,
  gatewayDesktopCapabilityNames,
} from '@educanvas/gateway-core';
import {
  encodeGatewayConformanceNdjson,
  gatewayCrossEntryConformance,
} from '../../../tooling/test-fixtures/gateway-cross-entry-conformance';
import { GatewayClient } from './client';

/**
 * 交叉入口合规测试：客户端只提交公共请求体，trust 边界字段（principal/profile）
 * 在服务端解析，不允许通过公开端点透传。
 */
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
      'capabilities',
      'clientMessageId',
      'conversationId',
      'notebookId',
      'parts',
    ]);
    expect(body).not.toHaveProperty('principal');
    expect(body).not.toHaveProperty('agentProfileId');
  });

  it('desktop 首版能力名全部是合法 gateway 能力名且不信任客户端身份', () => {
    for (const name of gatewayDesktopCapabilityNames) {
      expect(gatewayCapabilityNameSchema.safeParse(name).success).toBe(true);
    }
    expect(
      gatewayCrossEntryConformance.request.capabilities.capabilities,
    ).toEqual([...gatewayDesktopCapabilityNames]);
    expect(gatewayCrossEntryConformance.request).not.toHaveProperty(
      'principal',
    );
    expect(gatewayCrossEntryConformance.request).not.toHaveProperty(
      'agentProfileId',
    );
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

  it('恢复请求只消费游标后的稳定事件且保留唯一终态', async () => {
    let requestedUrl = '';
    const suffix = gatewayCrossEntryConformance.completed.slice(2);
    const client = new GatewayClient(
      'http://127.0.0.1:3200',
      't'.repeat(32),
      async (input) => {
        requestedUrl = String(input);
        return Response.json({ events: suffix });
      },
    );

    const events = await client.resume('operation:cross-entry', 1);

    expect(requestedUrl).toContain(
      '/v1/client/operations/operation%3Across-entry/events?after=1',
    );
    expect(events).toEqual(suffix);
    expect(events.at(-1)?.type).toBe('operation.completed');
  });
});
