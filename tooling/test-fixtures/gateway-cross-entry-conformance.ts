import type { GatewayClientTurnRequest } from '../../packages/gateway-core/src/envelopes';
import type { GatewayOperationEvent } from '../../packages/gateway-core/src/events';
import type { GatewayResolvedRoute } from '../../packages/gateway-core/src/routing';

const operationId = 'operation:cross-entry';
const occurredAt = '2026-07-23T08:00:00.000Z';

function eventBase(sequence: number) {
  return {
    protocol: 'gateway.v1' as const,
    eventId: `event:cross-entry:${sequence}`,
    operationId,
    sequence,
    occurredAt,
  };
}

/**
 * 各入口协议实现共用的最小合规夹具。它只冻结公共请求、可信路由和
 * Gateway事件语义，不授予工具权限，也不替代各组合根自己的归属校验。
 */
export const gatewayCrossEntryConformance = {
  request: {
    clientMessageId: 'message:cross-entry',
    notebookId: 'notebook:cross-entry',
    conversationId: 'conversation:cross-entry',
    parts: [{ type: 'text', text: '解释为什么需要审批' }],
  } satisfies GatewayClientTurnRequest,
  resolvedRoute: {
    actorUserId: 'user:cross-entry',
    agentId: 'agent:cross-entry',
    notebookId: 'notebook:cross-entry',
    conversationId: 'conversation:cross-entry',
    agentProfileId: 'general',
    membershipRole: 'owner',
  } satisfies GatewayResolvedRoute,
  completed: [
    { ...eventBase(0), type: 'operation.accepted' },
    {
      ...eventBase(1),
      type: 'message.started',
      userMessageId: 'message:user:cross-entry',
      assistantMessageId: 'message:assistant:cross-entry',
      replayed: false,
    },
    { ...eventBase(2), type: 'message.delta', delta: '需要先确认。' },
    {
      ...eventBase(3),
      type: 'operation.completed',
      messageId: 'message:assistant:cross-entry',
    },
  ] satisfies readonly GatewayOperationEvent[],
  approvalPending: [
    { ...eventBase(0), type: 'operation.accepted' },
    {
      ...eventBase(1),
      type: 'message.started',
      userMessageId: 'message:user:cross-entry',
      assistantMessageId: 'message:assistant:cross-entry',
      replayed: false,
    },
    { ...eventBase(2), type: 'message.delta', delta: '需要先确认。' },
    {
      ...eventBase(3),
      type: 'approval.required',
      approval: {
        approvalId: 'approval:cross-entry',
        operationId,
        actorUserId: 'user:cross-entry',
        capability: 'external.mcp.invoke',
        risk: 'l2',
        summary: '调用外部服务',
        requestedAt: occurredAt,
        expiresAt: '2026-07-23T08:05:00.000Z',
      },
    },
  ] satisfies readonly GatewayOperationEvent[],
  cancelled: [
    { ...eventBase(0), type: 'operation.accepted' },
    {
      ...eventBase(1),
      type: 'message.started',
      userMessageId: 'message:user:cross-entry',
      assistantMessageId: 'message:assistant:cross-entry',
      replayed: false,
    },
    { ...eventBase(2), type: 'message.delta', delta: '正在回答。' },
    { ...eventBase(3), type: 'operation.cancelled' },
  ] satisfies readonly GatewayOperationEvent[],
  capabilityUnavailable: [
    { ...eventBase(0), type: 'operation.accepted' },
    {
      ...eventBase(1),
      type: 'operation.failed',
      code: 'CAPABILITY_UNAVAILABLE',
      retryable: false,
    },
  ] satisfies readonly GatewayOperationEvent[],
} as const;

/** 把合规事件编码为Gateway公共NDJSON传输，不添加隐式终态。 */
export function encodeGatewayConformanceNdjson(
  events: readonly GatewayOperationEvent[],
): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}
