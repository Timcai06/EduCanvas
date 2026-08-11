import { randomUUID } from 'node:crypto';
import { GatewayClient, GatewayClientError } from '@educanvas/gateway-client';
import type {
  GatewayClientTurnRequest,
  GatewayOperationEvent,
} from '@educanvas/gateway-core';
import type { StoredDesktopSession } from './desktop-session-store';
import type { TurnResult } from '../shared/turn-result';

export interface AssistantProxy {
  turn(input: { text: string }, signal?: AbortSignal): Promise<TurnResult>;
}

interface GatewayClientPort {
  streamTurn(
    request: GatewayClientTurnRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<GatewayOperationEvent>;
  cancelOperation(operationId: string): Promise<unknown>;
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
        cancelStarted = true;
        if (!operationId) {
          streamAbort.abort();
          return;
        }
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
            clientMessageId: `desktop:${randomUUID()}`,
            notebookId: session.notebookId,
            conversationId: session.conversationId,
            parts: [{ type: 'text', text: input.text }],
          },
          { signal: streamAbort.signal },
        )) {
          if (event.type === 'operation.accepted') {
            operationId = event.operationId;
            if (userAborted || timedOut) cancelRemoteThenStream();
          } else if (event.type === 'message.delta') {
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
  };
}
