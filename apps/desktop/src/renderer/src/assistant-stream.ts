import type { DesktopChatHistorySnapshot } from '../../shared/chat-history';
import type {
  DesktopArtifactRef,
  DesktopChatMessage,
  DesktopChatMessageStatus,
} from '../../shared/chat-history';
import type { DesktopAssistantProjection } from '../../shared/assistant-projection';
import { desktopStreamKey } from '../../shared/assistant-projection';

const TERMINAL_STATUS: Record<
  Extract<DesktopAssistantProjection, { type: 'final' }>['status'],
  DesktopChatMessageStatus
> = {
  completed: 'completed',
  failed: 'failed',
  aborted: 'cancelled',
  interrupted: 'interrupted',
  timeout: 'failed',
  unauthenticated: 'failed',
};

const streamingMessageId = (
  projection: Pick<DesktopAssistantProjection, 'clientMessageId' | 'requestId'>,
): string => `streaming:${desktopStreamKey(projection)}`;

/**
 * 把受限流式投影应用到 renderer 的对话视图（DP05/DP06）。
 *
 * - 处理 message.started / delta / final / tool / citation / artifact / approval；
 *   accepted 不改变消息列表，返回 null；
 * - 用 conversationId 丢弃旧 operation 的迟到事件（防串会话）；
 * - message.started / delta 确保存在流式占位消息并原位追加 delta；
 * - citation / artifact / approval 原位保留结构化事件到同一流式占位消息
 *   （DP06 保留资源身份，卡片 UI 留 DP07）；
 * - final 只把占位标记为终态，内容校正由 main 完成后的 canonical 历史快照覆盖。
 */
export function applyAssistantProjection(
  snapshot: DesktopChatHistorySnapshot,
  projection: DesktopAssistantProjection,
): DesktopChatHistorySnapshot | null {
  if (projection.conversationId !== snapshot.conversationId) return null;
  if (
    projection.type !== 'message.started' &&
    projection.type !== 'delta' &&
    projection.type !== 'final' &&
    projection.type !== 'citation' &&
    projection.type !== 'artifact' &&
    projection.type !== 'approval' &&
    projection.type !== 'tool'
  ) {
    return null;
  }

  const id = streamingMessageId(projection);
  const messages = snapshot.messages;
  const index = messages.findIndex((message) => message.id === id);

  if (projection.type === 'final') {
    if (index === -1) return null;
    const status = TERMINAL_STATUS[projection.status];
    return {
      ...snapshot,
      messages: messages.map((message) =>
        message.id === id ? { ...message, status } : message,
      ),
    };
  }

  if (projection.type === 'citation') {
    return attachStructured(snapshot, projection, (message) => ({
      ...message,
      citations: [...(message.citations ?? []), projection.citation],
    }));
  }
  if (projection.type === 'artifact') {
    return attachStructured(snapshot, projection, (message) =>
      mergeArtifact(message, projection.artifact),
    );
  }
  if (projection.type === 'approval') {
    return attachStructured(snapshot, projection, (message) => {
      if (projection.status === 'resolved') {
        // 只清除当前待决审批；迟到/不匹配的 resolved 不产生状态变化。
        if (message.pendingApproval?.approvalId !== projection.approvalId) {
          return null;
        }
        return { ...message, pendingApproval: null };
      }
      return { ...message, pendingApproval: projection.approval };
    });
  }
  if (projection.type === 'tool') {
    return attachStructured(snapshot, projection, (message) => {
      const activities = message.toolActivities ?? [];
      const previous = activities.find(
        (item) => item.toolCallId === projection.toolCallId,
      );
      const next = {
        toolCallId: projection.toolCallId,
        summary: projection.summary ?? previous?.summary ?? '正在处理学习任务',
        status: projection.status,
      };
      return {
        ...message,
        toolActivities: previous
          ? activities.map((item) =>
              item.toolCallId === projection.toolCallId ? next : item,
            )
          : [...activities, next],
      };
    });
  }

  const delta = projection.type === 'delta' ? projection.delta : '';
  if (index === -1) {
    return {
      ...snapshot,
      messages: [
        ...messages,
        {
          id,
          clientMessageId: projection.clientMessageId,
          role: 'assistant',
          content: delta,
          source: 'text',
          status: 'streaming',
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return {
    ...snapshot,
    messages: messages.map((message) =>
      message.id === id
        ? { ...message, content: message.content + delta }
        : message,
    ),
  };
}

/** 结构化事件原位写入流式占位消息；占位缺失时以空内容创建。update 返回 null 表示无变化。 */
function attachStructured(
  snapshot: DesktopChatHistorySnapshot,
  projection: Extract<
    DesktopAssistantProjection,
    { type: 'citation' | 'artifact' | 'approval' | 'tool' }
  >,
  update: (message: DesktopChatMessage) => DesktopChatMessage | null,
): DesktopChatHistorySnapshot {
  const id = streamingMessageId(projection);
  const base: DesktopChatMessage = {
    id,
    clientMessageId: projection.clientMessageId,
    role: 'assistant',
    content: '',
    source: 'text',
    status: 'streaming',
    createdAt: new Date().toISOString(),
  };
  const index = snapshot.messages.findIndex((message) => message.id === id);
  const next = update(index === -1 ? base : snapshot.messages[index]!);
  if (!next) return snapshot;
  if (index === -1) {
    return { ...snapshot, messages: [...snapshot.messages, next] };
  }
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.id === id ? next : message,
    ),
  };
}

/** 按 artifactId 合并生命周期事件；kind/title 只在 proposed 阶段可得，后续阶段保留旧值。 */
function mergeArtifact(
  message: DesktopChatMessage,
  incoming: DesktopArtifactRef,
): DesktopChatMessage {
  const artifacts = message.artifacts ?? [];
  const index = artifacts.findIndex(
    (item) => item.artifactId === incoming.artifactId,
  );
  if (index === -1) {
    return { ...message, artifacts: [...artifacts, incoming] };
  }
  const previous = artifacts[index]!;
  const merged: DesktopArtifactRef = {
    ...previous,
    ...incoming,
    artifactKind: incoming.artifactKind ?? previous.artifactKind,
    title: incoming.title ?? previous.title,
  };
  return {
    ...message,
    artifacts: artifacts.map((item) =>
      item.artifactId === incoming.artifactId ? merged : item,
    ),
  };
}
