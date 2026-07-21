import 'server-only';

import type { TurnApplicationEvent } from '@educanvas/agent-core';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import { toGatewayFailureCode } from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';

function safeFailureMessage(
  code: string,
  audience: 'general' | 'teaching',
): string {
  if (code === 'RATE_LIMITED') return '请求较多，请稍后重试。';
  if (code === 'POLICY_BLOCKED') return '这轮内容已由安全规则停止。';
  if (code === 'CAPABILITY_UNAVAILABLE') return '当前能力暂时不可用。';
  if (audience === 'teaching') {
    return 'AI 老师暂时无法连接，请稍后重试。';
  }
  return 'AI 暂时无法回答，请稍后重试。';
}

function displayToolLabel(tool: string): string {
  if (['web_search', 'web.search', 'webSearch'].includes(tool)) {
    return '正在搜索网页';
  }
  if (['web_fetch', 'web.fetch', 'fetchWebPage'].includes(tool)) {
    return '正在读取网页';
  }
  return tool;
}

/**
 * 统一 Turn Application 到浏览器 SSE 的兼容投影。
 * approval 由独立控制面呈现，因此不伪装成聊天流事件。
 */
export function projectTurnApplicationEventToWeb(
  event: TurnApplicationEvent,
  audience: 'general' | 'teaching' = 'general',
): TeachingTurnEvent | null {
  const base = { schemaVersion: '1' as const, turnId: event.operationId };
  switch (event.type) {
    case 'turn.started':
      return {
        ...base,
        type: 'turn.accepted',
        studentMessageId: event.userMessageId,
        assistantMessageId: event.assistantMessageId,
        replayed: event.replayed,
      };
    case 'message.delta':
      return {
        ...base,
        type: 'message.delta',
        messageId: event.messageId,
        delta: event.delta,
      };
    case 'message.citation': {
      const common = {
        ...base,
        type: 'message.citation' as const,
        messageId: event.messageId,
        citationId: event.citationId,
        marker: event.marker,
        label: event.label,
        pageStart:
          event.target.kind === 'knowledge' ? event.target.pageStart : null,
        pageEnd:
          event.target.kind === 'knowledge' ? event.target.pageEnd : null,
      };
      return { ...common, ...event.target };
    }
    case 'tool.started':
      return {
        ...base,
        type: 'tool.started',
        toolCallId: event.toolCallId,
        label: event.label ?? displayToolLabel(event.tool),
      };
    case 'tool.completed':
      return { ...base, type: 'tool.completed', toolCallId: event.toolCallId };
    case 'tool.failed':
      return {
        ...base,
        type: 'tool.failed',
        toolCallId: event.toolCallId,
        code: toGatewayFailureCode(event.code),
      };
    case 'approval.required':
      return null;
    case 'artifact.proposed':
      return {
        ...base,
        type: 'artifact.proposed',
        artifactId: event.artifactId,
        kind: event.artifactKind,
        trustTier: event.trustTier,
        title: event.title,
      };
    case 'artifact.version_added':
      return {
        ...base,
        type: 'artifact.version_added',
        artifactId: event.artifactId,
        version: Number(event.versionId) || 1,
      };
    case 'artifact.generation_progress':
      return {
        ...base,
        type: 'artifact.generation_progress',
        artifactId: event.artifactId,
        jobId: event.jobId,
        progress: event.progress,
      };
    case 'artifact.failed':
      return {
        ...base,
        type: 'artifact.failed',
        artifactId: event.artifactId,
        ...(event.jobId === null ? {} : { jobId: event.jobId }),
        code: toGatewayFailureCode(event.code),
      };
    case 'turn.completed':
      return { ...base, type: 'turn.completed', messageId: event.messageId };
    case 'turn.failed': {
      const code = toGatewayFailureCode(event.code);
      return {
        ...base,
        type: 'turn.failed',
        messageId: event.messageId,
        code,
        message: safeFailureMessage(code, audience),
        retryable: event.retryable,
      };
    }
    case 'turn.cancelled':
      return { ...base, type: 'turn.cancelled', messageId: event.messageId };
  }
}

/** Gateway 持久事件到旧 Web SSE 的兼容投影，迁移期与 canonical 投影共享语义。 */
export async function* gatewayToLegacy(
  events: AsyncIterable<GatewayOperationEvent>,
  audience: 'general' | 'teaching' = 'general',
): AsyncGenerator<TeachingTurnEvent> {
  let assistantMessageId: string | null = null;
  for await (const event of events) {
    const base = { schemaVersion: '1' as const, turnId: event.operationId };
    switch (event.type) {
      case 'operation.accepted':
        break;
      case 'message.started':
        assistantMessageId = event.assistantMessageId;
        yield {
          ...base,
          type: 'turn.accepted',
          studentMessageId: event.userMessageId,
          assistantMessageId: event.assistantMessageId,
          replayed: event.replayed,
        };
        break;
      case 'message.delta':
        if (!assistantMessageId) break;
        yield {
          ...base,
          type: 'message.delta',
          messageId: assistantMessageId,
          delta: event.delta,
        };
        break;
      case 'message.citation': {
        const common = {
          ...base,
          type: 'message.citation' as const,
          messageId: event.messageId,
          citationId: event.citation.citationId,
          marker: event.citation.marker,
          label: event.citation.label,
          pageStart:
            event.citation.target.kind === 'knowledge'
              ? event.citation.target.pageStart
              : null,
          pageEnd:
            event.citation.target.kind === 'knowledge'
              ? event.citation.target.pageEnd
              : null,
        };
        if (event.citation.target.kind === 'web') {
          yield { ...common, ...event.citation.target };
        } else if (event.citation.target.kind === 'knowledge') {
          yield { ...common, ...event.citation.target };
        }
        break;
      }
      case 'tool.started':
        yield {
          ...base,
          type: 'tool.started',
          toolCallId: event.toolCallId,
          label: displayToolLabel(event.tool),
        };
        break;
      case 'tool.completed':
        yield { ...base, type: 'tool.completed', toolCallId: event.toolCallId };
        break;
      case 'tool.failed':
        yield {
          ...base,
          type: 'tool.failed',
          toolCallId: event.toolCallId,
          code: event.code,
        };
        break;
      case 'operation.completed':
        yield { ...base, type: 'turn.completed', messageId: event.messageId };
        break;
      case 'operation.failed':
        yield {
          ...base,
          type: 'turn.failed',
          messageId: assistantMessageId ?? event.operationId,
          code: event.code,
          message: safeFailureMessage(event.code, audience),
          retryable: event.retryable,
        };
        break;
      case 'operation.cancelled':
        yield {
          ...base,
          type: 'turn.cancelled',
          messageId: assistantMessageId ?? event.operationId,
        };
        break;
      case 'artifact.proposed':
        yield {
          ...base,
          type: 'artifact.proposed',
          artifactId: event.artifactId,
          kind: event.artifactKind,
          trustTier: 'tier1',
          title: event.title,
        };
        break;
      case 'artifact.version_added':
        yield {
          ...base,
          type: 'artifact.version_added',
          artifactId: event.artifactId,
          version: Number(event.versionId) || 1,
        };
        break;
      case 'artifact.generation_progress':
        yield {
          ...base,
          type: 'artifact.generation_progress',
          artifactId: event.artifactId,
          jobId: event.jobId,
          progress: event.progress,
        };
        break;
      case 'artifact.failed':
        yield {
          ...base,
          type: 'artifact.failed',
          artifactId: event.artifactId,
          ...(event.jobId === null ? {} : { jobId: event.jobId }),
          code: event.code,
        };
        break;
      case 'approval.required':
      case 'approval.resolved':
        break;
    }
  }
}
