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

/**
 * 一次 Turn 的稳定身份上报通道。proxy 在流式消费过程中写回 operationId 与
 * 已消费的最后 sequence，main 据此维护 Operation 注册表以支持断线续传。
 */
export interface TurnTracker {
  operationId: string | null;
  lastSequence: number;
  onAccepted?: (operationId: string) => void;
  onSequence?: (sequence: number) => void;
  /** 原始 gateway 事件上报，供 main 翻译为受限投影广播（DP05 真实流式）。 */
  onEvent?: (event: GatewayOperationEvent) => void;
}

export interface AssistantProxy {
  turn(
    input: {
      text: string;
      cursor?: { notebookId: string; conversationId: string };
      clientMessageId?: string;
    },
    signal?: AbortSignal,
    tracker?: TurnTracker,
  ): Promise<TurnResult>;
  /** 从 afterSequence 续传同一 Operation，回放事件快照并收口终态。 */
  resume(
    input: { operationId: string; afterSequence: number },
    signal?: AbortSignal,
    tracker?: TurnTracker,
  ): Promise<TurnResult>;
  /** best-effort 远端取消（应用退出时对在途 Operation 收口）。 */
  cancel(operationId: string): Promise<unknown>;
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
    // 桌面 Turn 由客户端注入冻结的 desktop capability manifest（DP06），调用方无需携带。
    request: Omit<GatewayClientTurnRequest, 'capabilities'>,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<GatewayOperationEvent>;
  cancelOperation(operationId: string): Promise<unknown>;
  resume?(
    operationId: string,
    afterSequence?: number,
  ): Promise<readonly GatewayOperationEvent[]>;
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

function reportEvent(
  tracker: TurnTracker | undefined,
  event: GatewayOperationEvent,
): void {
  if (!tracker) return;
  if (event.sequence > tracker.lastSequence) {
    tracker.lastSequence = event.sequence;
    tracker.onSequence?.(event.sequence);
  }
}

function acceptOperation(
  tracker: TurnTracker | undefined,
  operationId: string,
): void {
  if (!tracker) return;
  tracker.operationId = operationId;
  tracker.onAccepted?.(operationId);
}

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

  const makeClient = (session: StoredDesktopSession): GatewayClientPort =>
    options.clientFactory
      ? options.clientFactory(session)
      : new GatewayClient(
          session.gatewayBaseUrl,
          session.token,
          options.fetchImpl,
        );

  return {
    async turn(input, signal, tracker) {
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
      const client = makeClient(session);
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
          reportEvent(tracker, event);
          tracker?.onEvent?.(event);
          if (event.type === 'operation.accepted') {
            operationId = event.operationId;
            acceptOperation(tracker, event.operationId);
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
        // 流意外结束且无终态：operationId 已知则标记可续传，否则只能当普通失败。
        if (operationId) {
          return {
            ok: false,
            code: 'interrupted',
            message: '连接中断，可重试续传。',
          };
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
        if (operationId) {
          return {
            ok: false,
            code: 'interrupted',
            message: '连接中断，可重试续传。',
          };
        }
        return { ok: false, code: 'http', message: '连接中断，请重试。' };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onUserAbort);
      }
    },

    async resume(input, signal, tracker) {
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
      const client = makeClient(session);
      if (tracker) tracker.operationId = input.operationId;
      if (!client.resume) {
        return {
          ok: false,
          code: 'http',
          message: '当前客户端不支持续传。',
        };
      }
      try {
        const events = await client.resume(
          input.operationId,
          input.afterSequence,
        );
        for (const event of events) {
          reportEvent(tracker, event);
          tracker?.onEvent?.(event);
          if (event.type === 'operation.accepted') {
            acceptOperation(tracker, event.operationId);
          } else if (event.type === 'operation.completed') {
            return { ok: true, action: 'answered', message: '已恢复。' };
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
          }
        }
        // 快照内无终态：Operation 仍在运行，保留入口供后续续传。
        return {
          ok: false,
          code: 'interrupted',
          message: '回复仍在处理中，请稍后继续。',
        };
      } catch (error) {
        if (signal?.aborted) {
          return { ok: false, code: 'aborted', message: '已取消。' };
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
        return {
          ok: false,
          code: 'interrupted',
          message: '连接中断，可重试续传。',
        };
      }
    },

    async cancel(operationId) {
      const session = await options.getSession();
      if (!session) return;
      return makeClient(session).cancelOperation(operationId);
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
