'use client';

import { useMemo } from 'react';
import type {
  AssistantMessage,
  ChatMessage,
  MessageArtifactDTO,
  MessageCitationDTO,
  MessageToolStep,
} from './messages';

/**
 * L01 同源投影：从消息列表中提取当前 Assistant 消息的稳定身份与文本。
 *
 * General 与 Learning 使用同一套投影语义，不维护第二份完整回答。
 * Live 面板消费此投影的 text 作为视觉显示事实源（不是 TTS 字幕）。
 *
 * 设计要点：
 * - 只读 selector，不持有状态、不复制文本、不从 TTS 队列反推完整回答；
 * - 按 turnId 降序取最新 assistant 消息，避免历史消息被误当成本轮新回答；
 * - clientMessageId 是稳定身份语义，用于 Live 会话与失效游标；
 * - text 来自 Turn reducer 中 message.delta 的增量增长，是唯一视觉事实源；
 * - status 是消息级终态（pending/streaming/completed/failed/cancelled/interrupted）。
 */
export interface AssistantMessageProjection {
  readonly assistantId: string | null;
  readonly assistantText: string | null;
  readonly assistantStatus: AssistantMessage['status'] | null;
  readonly assistantArtifacts: readonly MessageArtifactDTO[];
  readonly assistantCitations: readonly MessageCitationDTO[];
  readonly assistantToolSteps: readonly MessageToolStep[];
}

/**
 * 从消息列表中投影当前 Assistant 消息。
 *
 * 规则：
 * 1. 取最后一个 `role === 'assistant'` 的消息（按 turnId 降序）；
 * 2. 该消息的 clientMessageId 作为稳定身份；
 * 3. 该消息的 text 是视觉显示事实源（message.delta 增量增长）；
 * 4. 历史 Assistant 消息不会被误当成本轮新回答（只取最后一个）；
 * 5. TTS 未播放、静音或失败不影响视觉文本（text 独立于 PCM 播放状态）。
 */
export function projectAssistantMessage(
  messages: readonly ChatMessage[],
): AssistantMessageProjection {
  const lastAssistant = [...messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === 'assistant',
    );

  if (!lastAssistant) {
    return {
      assistantId: null,
      assistantText: null,
      assistantStatus: null,
      assistantArtifacts: [],
      assistantCitations: [],
      assistantToolSteps: [],
    };
  }

  return {
    assistantId: lastAssistant.clientMessageId ?? null,
    assistantText: lastAssistant.text || null,
    assistantStatus: lastAssistant.status,
    assistantArtifacts: lastAssistant.artifacts ?? [],
    assistantCitations: lastAssistant.citations ?? [],
    assistantToolSteps: lastAssistant.toolSteps ?? [],
  };
}

/**
 * React hook 版本：从 messages 列表中稳定投影当前 Assistant 消息。
 *
 * 使用 useMemo 避免每次渲染重新计算；messages 引用变化时自动重算。
 */
export function useAssistantMessageProjection(
  messages: readonly ChatMessage[],
): AssistantMessageProjection {
  return useMemo(() => projectAssistantMessage(messages), [messages]);
}
