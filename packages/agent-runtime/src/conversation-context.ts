import type { ModelMessage } from '@educanvas/agent-core';

export const CONVERSATION_CONTEXT_VERSION = 'conversation-context-v1' as const;

export interface ConversationContextMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationContextOptions {
  maxMessages?: number;
  maxCharacters?: number;
}

export interface ConversationContextSnapshot {
  version: typeof CONVERSATION_CONTEXT_VERSION;
  messages: readonly ModelMessage[];
  includedMessageIds: readonly string[];
  omittedMessageCount: number;
  characterCount: number;
}

const DEFAULT_MAX_MESSAGES = 20;
const DEFAULT_MAX_CHARACTERS = 24_000;

/**
 * 从按时间升序排列的持久化消息中构造有界上下文。
 *
 * Runtime 只保留完整消息，并从最新消息向前装箱；这避免静默截断一句话后改变
 * 语义。当前用户输入由具体 Turn Orchestrator 单独追加，不应传入本函数。
 */
export function buildConversationContext(
  history: readonly ConversationContextMessage[],
  options: ConversationContextOptions = {},
): ConversationContextSnapshot {
  const maxMessages = Math.max(
    0,
    Math.min(options.maxMessages ?? DEFAULT_MAX_MESSAGES, 100),
  );
  const maxCharacters = Math.max(
    0,
    Math.min(options.maxCharacters ?? DEFAULT_MAX_CHARACTERS, 128_000),
  );
  const selected: ConversationContextMessage[] = [];
  let characterCount = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index];
    if (!candidate) continue;
    const content = candidate.content.trim();
    if (!content) continue;
    if (selected.length >= maxMessages) break;
    if (characterCount + content.length > maxCharacters) break;
    selected.push({ ...candidate, content });
    characterCount += content.length;
  }

  selected.reverse();
  return {
    version: CONVERSATION_CONTEXT_VERSION,
    messages: selected.map(({ role, content }) => ({ role, content })),
    includedMessageIds: selected.map(({ id }) => id),
    omittedMessageCount: history.length - selected.length,
    characterCount,
  };
}
