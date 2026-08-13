import { randomUUID } from 'node:crypto';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
  DesktopChatMessageInput,
} from '../shared/chat-history';

export interface ChatHistoryStore {
  append(input: DesktopChatMessageInput): DesktopChatMessage;
  snapshot(): readonly DesktopChatMessage[];
  state(): DesktopChatHistorySnapshot;
  subscribe(
    listener: (messages: readonly DesktopChatMessage[]) => void,
  ): () => void;
}

export function createChatHistoryStore(
  dependencies: { createId(): string; now(): Date } = {
    createId: randomUUID,
    now: () => new Date(),
  },
): ChatHistoryStore {
  const messages: DesktopChatMessage[] = [];
  const listeners = new Set<
    (messages: readonly DesktopChatMessage[]) => void
  >();
  let revision = 0;
  const snapshot = (): readonly DesktopChatMessage[] =>
    Object.freeze(messages.map((message) => Object.freeze({ ...message })));

  return {
    append(input) {
      const content = input.content.trim();
      if (!content) throw new Error('Chat message cannot be blank');
      const message = Object.freeze({
        id: dependencies.createId(),
        role: input.role,
        content,
        source: input.source,
        createdAt: dependencies.now().toISOString(),
      });
      messages.push(message);
      revision += 1;
      const current = snapshot();
      for (const listener of listeners) listener(current);
      return message;
    },
    snapshot,
    state: () => Object.freeze({ revision, messages: snapshot() }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
