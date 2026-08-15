import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import type { DesktopAssistantProjection } from '../shared/assistant-projection';

export interface AssistantProjectionContext {
  requestId: string;
  clientMessageId: string | null;
  conversationId: string;
}

const FINAL_MESSAGES = {
  completed: '完成。',
  aborted: '已取消。',
  interrupted: '连接中断，可重试续传。',
} as const;

function safeToolSummary(tool: string): string {
  const normalized = tool.toLowerCase();
  if (/search|retrieve|browse|source|knowledge/.test(normalized))
    return '正在查找相关资料';
  if (/artifact|slide|mind|image|generate|create/.test(normalized))
    return '正在生成学习内容';
  if (/calculate|math|code|execute/.test(normalized)) return '正在计算和验证';
  return '正在处理学习任务';
}

/**
 * 把 gateway Operation 事件白名单化为 renderer 可见的受限投影（DP05/DP06）。
 * 透出 accepted/流式增量/工具生命周期/citation/artifact/approval/终态；
 * 结构化资源身份（citationId/artifactId/approvalId）在此层不丢失。
 */
export function toAssistantProjection(
  event: GatewayOperationEvent,
  context: AssistantProjectionContext,
): DesktopAssistantProjection | null {
  const base = {
    requestId: context.requestId,
    clientMessageId: context.clientMessageId,
    conversationId: context.conversationId,
    operationId: event.operationId,
  };
  switch (event.type) {
    case 'operation.accepted':
      return { ...base, type: 'accepted' };
    case 'message.started':
      return {
        ...base,
        type: 'message.started',
        assistantMessageId: event.assistantMessageId,
      };
    case 'message.delta':
      return {
        ...base,
        type: 'delta',
        sequence: event.sequence,
        delta: event.delta,
      };
    case 'tool.started':
      return {
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        summary: safeToolSummary(event.tool),
        status: 'started',
      };
    case 'tool.completed':
      return {
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        summary: null,
        status: 'completed',
      };
    case 'tool.failed':
      return {
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        summary: null,
        status: 'failed',
      };
    case 'message.citation':
      return {
        ...base,
        type: 'citation',
        sequence: event.sequence,
        citation: event.citation,
      };
    case 'artifact.proposed':
      return {
        ...base,
        type: 'artifact',
        artifact: {
          artifactId: event.artifactId,
          artifactKind: event.artifactKind,
          title: event.title,
          status: 'proposed',
        },
      };
    case 'artifact.version_added':
      return {
        ...base,
        type: 'artifact',
        artifact: {
          artifactId: event.artifactId,
          artifactKind: null,
          title: null,
          status: 'version_added',
          versionId: event.versionId,
        },
      };
    case 'artifact.generation_progress':
      return {
        ...base,
        type: 'artifact',
        artifact: {
          artifactId: event.artifactId,
          artifactKind: null,
          title: null,
          status: 'generating',
          progress: event.progress,
        },
      };
    case 'artifact.failed':
      return {
        ...base,
        type: 'artifact',
        artifact: {
          artifactId: event.artifactId,
          artifactKind: null,
          title: null,
          status: 'failed',
          code: event.code,
        },
      };
    case 'approval.required':
      return {
        ...base,
        type: 'approval',
        approvalId: event.approval.approvalId,
        status: 'required',
        approval: {
          approvalId: event.approval.approvalId,
          operationId: event.approval.operationId,
          capability: event.approval.capability,
          risk: event.approval.risk,
          summary: event.approval.summary,
          expiresAt: event.approval.expiresAt,
        },
      };
    case 'approval.resolved':
      return {
        ...base,
        type: 'approval',
        approvalId: event.decision.approvalId,
        status: 'resolved',
        approval: null,
      };
    case 'operation.completed':
      return {
        ...base,
        type: 'final',
        status: 'completed',
        message: FINAL_MESSAGES.completed,
        code: null,
      };
    case 'operation.failed':
      return {
        ...base,
        type: 'final',
        status: 'failed',
        message: event.retryable
          ? 'AI 老师暂时失败，请重试。'
          : 'AI 老师暂时无法完成。',
        code: event.code,
      };
    case 'operation.cancelled':
      return {
        ...base,
        type: 'final',
        status: 'aborted',
        message: FINAL_MESSAGES.aborted,
        code: 'CANCELLED',
      };
    default:
      return null;
  }
}
