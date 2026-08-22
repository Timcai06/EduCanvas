import { randomUUID } from 'node:crypto';
import { GatewayClient, GatewayClientError } from '@educanvas/gateway-client';
import type {
  GatewayClientTurnRequest,
  GatewayOperationEvent,
} from '@educanvas/gateway-core';
import type { StoredDesktopSession } from './desktop-session-store';
import type { TurnResult } from '../shared/turn-result';
import type { DesktopAttachmentRef } from '../shared/desktop-attachment';
import type { DesktopCanonicalMessage } from '../shared/chat-history';
import { toCanonicalMessage } from './message-history-projection';

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
      /** DP10：随本轮发出的已 ready 附件；服务端再验归属。 */
      attachment?: DesktopAttachmentRef;
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

const DEFAULT_TIMEOUT_MS = 120_000;
/**
 * If a caller cancels before the gateway tells us the operation id, keep the
 * stream alive briefly so a late `operation.accepted` can still be cancelled.
 * This is only a drain window; the renderer is released immediately.
 */
const CANCEL_DRAIN_TIMEOUT_MS = 5_000;

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
 * DP10：文本 + 可选附件拼成 Turn parts。asset_ref 引用不可变版本
 * （assetId/versionId/kind），usage 固定 attachment；kind 必须是服务端
 * asset kind 枚举成员，桌面输入只可能是 image/document。
 */
function buildTurnParts(
  text: string,
  attachment?: DesktopAttachmentRef,
): GatewayClientTurnRequest['parts'] {
  /* 空文本 + 附件时只发 asset_ref（agentTextPartSchema 拒绝空文本）；纯附件
     提交是合法输入，纯空文本在 renderer 层已被拦截。 */
  const parts: GatewayClientTurnRequest['parts'] = [];
  if (text.trim()) parts.push({ type: 'text', text });
  if (attachment) {
    parts.push({
      type: 'asset_ref',
      reference: {
        assetId: attachment.assetId,
        versionId: attachment.versionId,
        kind: attachment.kind as 'image' | 'document',
      },
      usage: 'attachment',
    });
  }
  return parts;
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
      // 附件绑定 pick 时刻的 notebookId；会话已切换到其他 notebook 时不得随
      // 新对话发出（服务端 requireNotebookAccess 兜底，这里在客户端即拒绝）。
      if (
        input.attachment &&
        input.attachment.notebookId !== cursor.notebookId
      ) {
        return {
          ok: false,
          code: 'route_required',
          message: '附件来自其他笔记本，请重新选择。',
        };
      }
      const client = makeClient(session);
      const streamAbort = new AbortController();
      let operationId: string | null = null;
      let userAborted = false;
      let timedOut = false;
      let cancelStarted = false;
      let drainTimeout: ReturnType<typeof setTimeout> | undefined;

      const cancelRemoteThenStream = (): void => {
        if (!operationId) return;
        if (!cancelStarted) {
          cancelStarted = true;
          void client.cancelOperation(operationId).catch(() => undefined);
        }
        // The remote cancel is best effort. Never keep the local turn (and
        // its renderer lease) waiting for a slow or unavailable cancel API.
        streamAbort.abort();
      };
      let resolveLocalTermination!: (result: TurnResult) => void;
      const localTermination = new Promise<TurnResult>((resolve) => {
        resolveLocalTermination = resolve;
      });
      let localTerminationSettled = false;
      const settleLocalTermination = (result: TurnResult): void => {
        if (localTerminationSettled) return;
        localTerminationSettled = true;
        resolveLocalTermination(result);
        drainTimeout = setTimeout(() => {
          streamAbort.abort();
        }, CANCEL_DRAIN_TIMEOUT_MS);
      };
      const onUserAbort = (): void => {
        userAborted = true;
        cancelRemoteThenStream();
        settleLocalTermination({
          ok: false,
          code: 'aborted',
          message: '已取消。',
        });
      };
      signal?.addEventListener('abort', onUserAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        cancelRemoteThenStream();
        settleLocalTermination({
          ok: false,
          code: 'timeout',
          message: '请求超时，请重试。',
        });
      }, timeoutMs);

      try {
        const consumeStream = async (): Promise<TurnResult> => {
          try {
            let answer = '';
            for await (const event of client.streamTurn(
              {
                clientMessageId:
                  input.clientMessageId ?? `desktop:${randomUUID()}`,
                notebookId: cursor.notebookId,
                conversationId: cursor.conversationId,
                parts: buildTurnParts(input.text, input.attachment),
              },
              { signal: streamAbort.signal },
            )) {
              // Once the renderer has received a local terminal result, keep
              // draining only long enough to discover a late operation id.
              // Do not project stale accepted/delta/final events into the UI.
              if (localTerminationSettled) {
                if (event.type === 'operation.accepted' && !operationId) {
                  operationId = event.operationId;
                  cancelRemoteThenStream();
                }
                continue;
              }
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
                  assistantMessageId: event.messageId,
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
            return {
              ok: false,
              code: 'http',
              message: '回答流意外结束，请重试。',
            };
          } catch (error) {
            if (signal?.aborted || userAborted) {
              return { ok: false, code: 'aborted', message: '已取消。' };
            }
            if (timedOut) {
              return {
                ok: false,
                code: 'timeout',
                message: '请求超时，请重试。',
              };
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
          }
        };
        const streamResult = consumeStream().finally(() => {
          if (drainTimeout) clearTimeout(drainTimeout);
        });
        const winner = await Promise.race([
          streamResult.then((result) => ({ kind: 'stream' as const, result })),
          localTermination.then((result) => ({
            kind: 'local' as const,
            result,
          })),
        ]);
        return winner.result;
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
