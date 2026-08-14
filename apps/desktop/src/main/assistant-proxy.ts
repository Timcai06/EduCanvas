import { randomUUID } from 'node:crypto';
import { GatewayClient, GatewayClientError } from '@educanvas/gateway-client';
import type {
  GatewayClientTurnRequest,
  GatewayMessageHistoryEntry,
  GatewayOperationEvent,
} from '@educanvas/gateway-core';
import type { StoredDesktopSession } from './desktop-session-store';
import type { TurnResult } from '../shared/turn-result';
import type { DesktopCanonicalMessage } from '../shared/chat-history';

export interface AssistantProxy {
  turn(
    input: {
      text: string;
      cursor?: { notebookId: string; conversationId: string };
      clientMessageId?: string;
    },
    signal?: AbortSignal,
  ): Promise<TurnResult>;
  /** 读取当前会话的服务端 canonical Message 页（最旧→最新），供 View Cache 重建/去重/向上加载。 */
  listMessagePage(
    conversationId: string,
    options?: { limit?: number; cursor?: string | null },
  ): Promise<{
    messages: DesktopCanonicalMessage[];
    nextCursor: string | null;
  }>;
}

interface GatewayClientPort {
  streamTurn(
    request: GatewayClientTurnRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<GatewayOperationEvent>;
  cancelOperation(operationId: string): Promise<unknown>;
}

function toCanonicalMessage(
  entry: GatewayMessageHistoryEntry,
): DesktopCanonicalMessage {
  return {
    messageId: entry.messageId,
    clientMessageId: entry.clientMessageId,
    role: entry.role,
    status: entry.status,
    content: entry.content,
    createdAt: entry.createdAt,
  };
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Desktop first-party Client → gateway.v1. The bearer stays in Electron main and
 * GatewayClient sends it only in Authorization; Renderer receives a stable projection.
 */
export function createAssistantProxy(options: {
  getSession(): Promise<StoredDesktopSession | null>;
  invalidateSession(): Promise<unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clientFactory?: (session: StoredDesktopSession) => GatewayClientPort;
}): AssistantProxy {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async turn(input, signal) {
      if (signal?.aborted) {
        return { ok: false, code: 'aborted', message: '已取消。' };
      }
      const session = await options.getSession();
      if (!session) {
        return {
          ok: false,
          code: 'unauthenticated',
          message: '请先登录 EduCanvas。',
        };
      }
      const cursor = input.cursor ?? session.initialCursor;
      if (!cursor) {
        return {
          ok: false,
          code: 'route_required',
          message: '请先选择一个对话。',
        };
      }
      const client = options.clientFactory
        ? options.clientFactory(session)
        : new GatewayClient(
            session.gatewayBaseUrl,
            session.token,
            options.fetchImpl,
          );
      const streamAbort = new AbortController();
      let operationId: string | null = null;
      let userAborted = false;
      let timedOut = false;
      let cancelStarted = false;

      const cancelRemoteThenStream = (): void => {
        if (cancelStarted) return;
        if (!operationId) return;
        cancelStarted = true;
        void client
          .cancelOperation(operationId)
          .catch(() => undefined)
          .finally(() => streamAbort.abort());
      };
      const onUserAbort = (): void => {
        userAborted = true;
        cancelRemoteThenStream();
      };
      signal?.addEventListener('abort', onUserAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        cancelRemoteThenStream();
      }, timeoutMs);

      try {
        let answer = '';
        for await (const event of client.streamTurn(
          {
            clientMessageId: input.clientMessageId ?? `desktop:${randomUUID()}`,
            notebookId: cursor.notebookId,
            conversationId: cursor.conversationId,
            parts: [{ type: 'text', text: input.text }],
          },
          { signal: streamAbort.signal },
        )) {
          if (event.type === 'operation.accepted') {
            operationId = event.operationId;
            if (userAborted || timedOut) cancelRemoteThenStream();
          } else if (event.type === 'message.delta') {
            if (timedOut) {
              return {
                ok: false,
                code: 'timeout',
                message: '请求超时，请重试。',
              };
            }
            if (userAborted || signal?.aborted) {
              return { ok: false, code: 'aborted', message: '已取消。' };
            }
            answer += event.delta;
          } else if (event.type === 'operation.failed') {
            return {
              ok: false,
              code: 'http',
              message: event.retryable
                ? 'AI 老师暂时失败，请重试。'
                : 'AI 老师暂时无法完成。',
            };
          } else if (event.type === 'operation.cancelled') {
            return { ok: false, code: 'aborted', message: '已取消。' };
          } else if (event.type === 'operation.completed') {
            if (timedOut) {
              return {
                ok: false,
                code: 'timeout',
                message: '请求超时，请重试。',
              };
            }
            if (userAborted || signal?.aborted) {
              return { ok: false, code: 'aborted', message: '已取消。' };
            }
            return {
              ok: true,
              action: 'answered',
              message: answer.trim() || '完成',
            };
          }
        }
        return { ok: false, code: 'http', message: '回答流意外结束，请重试。' };
      } catch (error) {
        if (signal?.aborted || userAborted) {
          return { ok: false, code: 'aborted', message: '已取消。' };
        }
        if (timedOut) {
          return { ok: false, code: 'timeout', message: '请求超时，请重试。' };
        }
        const status =
          error instanceof GatewayClientError
            ? error.status
            : (error as { status?: unknown }).status;
        if (status === 401) {
          await options.invalidateSession();
          return {
            ok: false,
            code: 'unauthenticated',
            message: '登录已失效，请重新登录。',
          };
        }
        return { ok: false, code: 'http', message: '连接中断，请重试。' };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onUserAbort);
      }
    },

    async listMessagePage(conversationId, input) {
      const session = await options.getSession();
      if (!session) return { messages: [], nextCursor: null };
      const client = new GatewayClient(
        session.gatewayBaseUrl,
        session.token,
        options.fetchImpl,
      );
      const page = await client.listMessagePage({
        conversationId,
        limit: input?.limit,
        cursor: input?.cursor ?? undefined,
      });
      return {
        messages: page.messages.map(toCanonicalMessage),
        nextCursor: page.nextCursor,
      };
    },
  };
}
