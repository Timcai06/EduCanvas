import { GatewayClient, GatewayClientError } from '@educanvas/gateway-client';
import type {
  GatewayConversationCreateRequest,
  GatewayConversationCreateResult,
  GatewayConversationDirectoryPage,
} from '@educanvas/gateway-core';
import type { StoredDesktopSession } from './desktop-session-store';
import type { DesktopConversationDirectorySnapshot } from '../shared/conversation-directory';

interface ConversationClientPort {
  listConversationPage(input?: {
    limit?: number;
    cursor?: string;
  }): Promise<GatewayConversationDirectoryPage>;
  createConversation(
    input: GatewayConversationCreateRequest,
  ): Promise<GatewayConversationCreateResult>;
}

export function createConversationCoordinator(options: {
  getSession(): Promise<StoredDesktopSession | null>;
  invalidateSession?(): Promise<unknown>;
  createClient?(session: StoredDesktopSession): ConversationClientPort;
}) {
  let revision = 0;
  let conversations: GatewayConversationDirectoryPage['conversations'] = [];
  let currentConversationId: string | null = null;
  let loading = false;
  let error: string | null = null;
  let generation = 0;

  const state = (): DesktopConversationDirectorySnapshot =>
    Object.freeze({
      revision,
      loading,
      conversations: Object.freeze([...conversations]),
      currentConversationId,
      error,
    });
  const clientFor = (session: StoredDesktopSession): ConversationClientPort =>
    options.createClient?.(session) ??
    new GatewayClient(session.gatewayBaseUrl, session.token);
  const fail = async (cause: unknown) => {
    if (cause instanceof GatewayClientError && cause.status === 401) {
      await options.invalidateSession?.();
      error = '登录已失效，请重新登录。';
    } else if (cause instanceof GatewayClientError && cause.status === 403) {
      error = '你没有访问这个对话的权限。';
    } else {
      error = '暂时无法读取对话目录，请稍后重试。';
    }
    loading = false;
    revision += 1;
    return state();
  };

  return {
    state,
    currentCursor() {
      const current = conversations.find(
        (item) => item.conversationId === currentConversationId,
      );
      return current
        ? {
            notebookId: current.notebookId,
            conversationId: current.conversationId,
          }
        : null;
    },
    async load(): Promise<DesktopConversationDirectorySnapshot> {
      const requestGeneration = ++generation;
      loading = true;
      error = null;
      revision += 1;
      try {
        const session = await options.getSession();
        if (!session) {
          if (requestGeneration !== generation) return state();
          conversations = [];
          currentConversationId = null;
          loading = false;
          revision += 1;
          return state();
        }
        const client = clientFor(session);
        const loaded: GatewayConversationDirectoryPage['conversations'] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listConversationPage({ limit: 50, cursor });
          loaded.push(...page.conversations);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        if (requestGeneration !== generation) return state();
        conversations = loaded;
        const preferred =
          currentConversationId ?? session.initialCursor?.conversationId;
        currentConversationId =
          conversations.find((item) => item.conversationId === preferred)
            ?.conversationId ??
          conversations[0]?.conversationId ??
          null;
        loading = false;
        revision += 1;
        return state();
      } catch (cause) {
        if (requestGeneration !== generation) return state();
        return fail(cause);
      }
    },
    select(conversationId: string): DesktopConversationDirectorySnapshot {
      if (!conversations.some((item) => item.conversationId === conversationId))
        throw new Error('conversation_not_found');
      if (currentConversationId !== conversationId) {
        generation += 1;
        currentConversationId = conversationId;
        error = null;
        revision += 1;
      }
      return state();
    },
    async create(
      input: GatewayConversationCreateRequest,
    ): Promise<DesktopConversationDirectorySnapshot> {
      const session = await options.getSession();
      if (!session) return fail(new GatewayClientError(401, 'UNAUTHENTICATED'));
      const requestGeneration = ++generation;
      loading = true;
      error = null;
      revision += 1;
      try {
        const result = await clientFor(session).createConversation(input);
        if (requestGeneration !== generation) return state();
        conversations = [
          result.conversation,
          ...conversations.filter(
            (item) =>
              item.conversationId !== result.conversation.conversationId,
          ),
        ];
        currentConversationId = result.conversation.conversationId;
        loading = false;
        revision += 1;
        return state();
      } catch (cause) {
        if (requestGeneration !== generation) return state();
        return fail(cause);
      }
    },
    reset(): DesktopConversationDirectorySnapshot {
      generation += 1;
      conversations = [];
      currentConversationId = null;
      loading = false;
      error = null;
      revision += 1;
      return state();
    },
  };
}

export type ConversationCoordinator = ReturnType<
  typeof createConversationCoordinator
>;
