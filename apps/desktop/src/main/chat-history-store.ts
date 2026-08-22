import { randomUUID } from 'node:crypto';
import type {
  DesktopCanonicalMessage,
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
  DesktopChatMessageInput,
} from '../shared/chat-history';

export interface ChatHistoryStore {
  setConversation(conversationId: string | null): void;
  append(input: DesktopChatMessageInput): DesktopChatMessage;
  /** 用服务端 canonical Message 重建视图；乐观 User Message 按 clientMessageId 去重。 */
  reconcile(
    canonical: readonly DesktopCanonicalMessage[],
    options?: { hasMore?: boolean; nextCursor?: string | null },
  ): void;
  /** 把更早的一页 prepend 到视图顶部，供「向上加载更早页」。 */
  prependEarlier(
    canonical: readonly DesktopCanonicalMessage[],
    options?: { hasMore?: boolean; nextCursor?: string | null },
  ): void;
  clear(): void;
  setLoading(loading: boolean): void;
  snapshot(): readonly DesktopChatMessage[];
  state(): DesktopChatHistorySnapshot;
  subscribe(
    listener: (messages: readonly DesktopChatMessage[]) => void,
  ): () => void;
}

function toDesktopMessage(
  canonical: DesktopCanonicalMessage,
): DesktopChatMessage {
  return {
    id: canonical.messageId,
    clientMessageId: canonical.clientMessageId,
    role: canonical.role,
    content: canonical.content,
    // 服务端 canonical Message 暂不携带来源；桌面 voice Turn 使用稳定前缀，
    // 因此历史重建和应用重启后仍能恢复语音标记。
    source:
      canonical.role === 'user' &&
      canonical.clientMessageId.startsWith('desktop:voice:')
        ? 'voice'
        : 'text',
    status: canonical.status,
    createdAt: canonical.createdAt,
    parts: canonical.parts ?? [],
    citations: canonical.citations ?? [],
  };
}

/**
 * 按 Conversation 分区的可删除、可重建 View Cache。它只持有当前会话的投影；
 * 服务端 canonical Message 是唯一事实，本地乐观消息在 canonical 到达后按
 * clientMessageId 去重。
 */
export function createChatHistoryStore(
  dependencies: { createId(): string; now(): Date } = {
    createId: randomUUID,
    now: () => new Date(),
  },
): ChatHistoryStore {
  let conversationId: string | null = null;
  let messages: DesktopChatMessage[] = [];
  let hasMore = false;
  let nextCursor: string | null = null;
  let loading = false;
  const listeners = new Set<
    (messages: readonly DesktopChatMessage[]) => void
  >();
  let revision = 0;

  const snapshot = (): readonly DesktopChatMessage[] =>
    Object.freeze(messages.map((message) => Object.freeze({ ...message })));
  const notify = (): void => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const bump = (): void => {
    revision += 1;
    notify();
  };

  return {
    setConversation(next) {
      conversationId = next;
      messages = [];
      hasMore = false;
      nextCursor = null;
      loading = false;
      bump();
    },
    append(input) {
      const content = input.content.trim();
      if (!content && !input.attachment) {
        throw new Error('Chat message cannot be blank');
      }
      const message = Object.freeze({
        id: dependencies.createId(),
        clientMessageId: input.clientMessageId ?? null,
        role: input.role,
        content,
        source: input.source,
        status: input.status ?? 'completed',
        createdAt: dependencies.now().toISOString(),
        ...(input.attachment ? { attachment: input.attachment } : {}),
      });
      messages.push(message);
      bump();
      return message;
    },
    reconcile(canonical, options) {
      const canonicalByClientId = new Set(
        canonical
          .map((item) => item.clientMessageId)
          .filter((value): value is string => Boolean(value)),
      );
      const pending = messages.filter(
        (message) =>
          message.role === 'user' &&
          message.clientMessageId !== null &&
          !canonicalByClientId.has(message.clientMessageId),
      );
      messages = [...canonical.map(toDesktopMessage), ...pending];
      if (options?.hasMore !== undefined) hasMore = options.hasMore;
      if (options?.nextCursor !== undefined) nextCursor = options.nextCursor;
      loading = false;
      bump();
    },
    prependEarlier(canonical, options) {
      const existingIds = new Set(messages.map((message) => message.id));
      const older = canonical
        .map(toDesktopMessage)
        .filter((message) => !existingIds.has(message.id));
      messages = [...older, ...messages];
      if (options?.hasMore !== undefined) hasMore = options.hasMore;
      if (options?.nextCursor !== undefined) nextCursor = options.nextCursor;
      loading = false;
      bump();
    },
    clear() {
      messages = [];
      hasMore = false;
      nextCursor = null;
      loading = false;
      bump();
    },
    setLoading(next) {
      loading = next;
      bump();
    },
    snapshot,
    state: () =>
      Object.freeze({
        revision,
        conversationId,
        messages: snapshot(),
        hasMore,
        nextCursor,
        loading,
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
