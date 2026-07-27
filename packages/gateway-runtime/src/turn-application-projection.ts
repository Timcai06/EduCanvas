/**
 * Turn Application → Gateway 事件投影 — 有损传输映射。
 *
 * ## 为什么需要投影
 *
 * TurnApplicationEvent（agent-core）和 GatewayOperationEvent（gateway-core）
 * 是两套独立的事件协议。Turn Application 聚焦教学/对话语义，
 * Gateway 聚焦传输/路由语义。投影层做类型映射，不改变业务含义。
 *
 * ## 谁负责什么
 *
 * - 本模块：只做事件类型映射（turn.started → message.started 等）
 * - GatewayOperationStore：负责序号分配、eventId 生成、持久化
 * - Gateway Service：负责编排（幂等、取消、流控）
 */

import type { TurnApplicationEvent } from '@educanvas/agent-core';
import {
  gatewayCapabilityNameSchema,
  type GatewayFailureCode,
} from '@educanvas/gateway-core';
import type { GatewayEventPayload } from './ports';

export interface GatewayTurnProjectionContext {
  /** Gateway 权威身份解析出的用户，而不是客户端声称的 actor。 */
  actorUserId: string;
  /** Gateway 追加事件时使用的服务端时间。 */
  occurredAt: string;
}

type TurnApplicationFailureCode = Extract<
  TurnApplicationEvent,
  { type: 'tool.failed' | 'artifact.failed' | 'turn.failed' }
>['code'];

/**
 * 把统一 Turn Application 事件投影成 Gateway payload。
 * 该边界只做有损传输映射；序号、eventId 与持久化由 GatewayOperationStore 负责。
 */
export function projectTurnApplicationEventToGateway(
  event: TurnApplicationEvent,
  context: GatewayTurnProjectionContext,
): GatewayEventPayload {
  switch (event.type) {
    case 'turn.started':
      return {
        type: 'message.started',
        userMessageId: event.userMessageId,
        assistantMessageId: event.assistantMessageId,
        replayed: event.replayed,
      };
    case 'message.delta':
      return { type: 'message.delta', delta: event.delta };
    case 'message.citation':
      return {
        type: 'message.citation',
        messageId: event.messageId,
        citation: {
          citationId: event.citationId,
          ...(event.marker === undefined ? {} : { marker: event.marker }),
          label: event.label,
          target: event.target,
        },
      };
    case 'tool.started':
      return {
        type: 'tool.started',
        toolCallId: event.toolCallId,
        tool: event.tool,
      };
    case 'tool.completed':
      return {
        type: 'tool.completed',
        toolCallId: event.toolCallId,
        summary: { label: event.summary ?? null },
      };
    case 'tool.failed':
      return {
        type: 'tool.failed',
        toolCallId: event.toolCallId,
        code: toGatewayFailureCode(event.code),
        retryable: event.retryable,
      };
    case 'approval.required': {
      const capability = gatewayCapabilityNameSchema.parse(event.capability);
      if (event.risk !== 'l2' && event.risk !== 'l3') {
        throw new Error('gateway_approval_requires_l2_or_l3');
      }
      return {
        type: 'approval.required',
        approval: {
          approvalId: event.approvalId,
          operationId: event.operationId,
          actorUserId: context.actorUserId,
          capability,
          risk: event.risk,
          summary: event.summary,
          requestedAt: context.occurredAt,
          expiresAt: event.expiresAt,
        },
      };
    }
    case 'artifact.proposed':
      return {
        type: 'artifact.proposed',
        artifactId: event.artifactId,
        artifactKind: event.artifactKind,
        title: event.title,
      };
    case 'artifact.version_added':
      return {
        type: 'artifact.version_added',
        artifactId: event.artifactId,
        versionId: event.versionId,
      };
    case 'artifact.generation_progress':
      return {
        type: 'artifact.generation_progress',
        artifactId: event.artifactId,
        jobId: event.jobId,
        progress: event.progress,
      };
    case 'artifact.failed':
      return {
        type: 'artifact.failed',
        artifactId: event.artifactId,
        jobId: event.jobId,
        code: toGatewayFailureCode(event.code),
      };
    case 'turn.completed':
      return { type: 'operation.completed', messageId: event.messageId };
    case 'turn.failed':
      return {
        type: 'operation.failed',
        code: toGatewayFailureCode(event.code),
        retryable: event.retryable,
      };
    case 'turn.cancelled':
      return { type: 'operation.cancelled' };
  }
}

/** 统一 Runtime 失败码到 Gateway 既有公开错误码的唯一映射。 */
export function toGatewayFailureCode(
  code: TurnApplicationFailureCode,
): GatewayFailureCode {
  switch (code) {
    case 'MODEL_FAILED':
    case 'TOOL_FAILED':
      return 'RUNTIME_FAILED';
    default:
      return code;
  }
}
