import type { AgentAssetPart } from '@educanvas/agent-core';
import type {
  AssistantMessage,
  ChatMessage,
  MessageArtifactDTO,
} from './messages';

/** 从失败消息恢复服务端可验证的附件引用，不重建浏览器临时上传对象。 */
export function getRetryAssetParts(
  message: AssistantMessage,
): readonly AgentAssetPart[] {
  return (message.retryParts ?? []).filter(
    (part): part is AgentAssetPart => part.type === 'asset_ref',
  );
}

/** 后台任务可晚于聊天终态；只更新已存在的产物引用，忽略过时版本。 */
export function applyObservedArtifact(
  messages: readonly ChatMessage[],
  observed: MessageArtifactDTO,
): readonly ChatMessage[] {
  return messages.map((message) =>
    message.role !== 'assistant' || !message.artifacts
      ? message
      : {
          ...message,
          artifacts: message.artifacts.map((artifact) =>
            artifact.id === observed.id &&
            observed.latestVersion >= artifact.latestVersion
              ? observed
              : artifact,
          ),
        },
  );
}

export function updateAssistant(
  messages: readonly ChatMessage[],
  id: string,
  update: (message: AssistantMessage) => AssistantMessage,
): readonly ChatMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.id === id
      ? update(message)
      : message,
  );
}
