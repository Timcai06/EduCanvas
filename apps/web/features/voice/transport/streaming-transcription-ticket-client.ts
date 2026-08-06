/**
 * V17-A ticket client — 受认证 HTTP client 边界（浏览器/SSR 均可导入）。
 *
 * ## 职责
 *
 * Gateway 的 `/v1/client/streaming-transcription/tickets` 用**长时 session
 * bearer** 换取短时（60 秒）、单次使用、绑定主体与 Notebook 的 WebSocket
 * 握手 ticket（V12）。浏览器无法设置 WebSocket 自定义 header，因此握手凭证
 * 只能走 `Sec-WebSocket-Protocol: ticket.<ticket>`；长时 bearer 一旦进入该
 * header 会被服务端原样 echo，并可能进入代理/网关/诊断日志——所以 ticket
 * 必须由 HTTPS 请求先行换取，本模块就是那一次 HTTPS 请求的唯一发生地。
 *
 * ## 安全纪律
 *
 * - bearer 只在本模块的 ticket 请求头中使用，**绝不**进入 WebSocket 握手、
 *   URL、日志或任何字段；
 * - ticket 是响应体内容，**不写入 URL query**（endpoint 是固定路径）；
 * - 本模块不持久化任何凭证：请求完成后 bearer 与 ticket 都只存在于局部
 *   变量与返回值中，由调用方（transport）在握手后立即丢弃；
 * - 浏览器 API（fetch）构造时注入：模块顶层不读取 window/WebSocket，SSR
 *   导入安全；
 * - 凭证投递目标受控：endpoint 只接受**同源相对路径**（`/` 开头、非
 *   `//`、不含 `://`），绝对 URL 在构造时抛 TypeError——bearer 绝不发往
 *   配置指向的任意地址，只允许投递到同源固定 BFF 端点；
 * - 失败只暴露稳定 code 与可选的稳定服务端 error code，不携带响应体、
 *   响应头或自由错误消息（CLAUDE.md 的"浏览器响应不得包含 Provider 原始
 *   body"要求）。
 *
 * ## 与 V17 的分工
 *
 * 浏览器拿不到 httpOnly session cookie，真实的受认证 fetch 由 V17 的
 * BFF route handler 提供（服务端读 cookie 后以 bearer 调 Gateway 或直接
 * 代理）；本模块定义调用方必须注入的 `StreamingTranscriptionTicketClient`
 * 接口，并提供一个可注入 fetch/bearer 的默认实现供测试与同构场景使用。
 */

import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import { z } from 'zod';

/** Gateway ticket 端点：固定路径，ticket 永不拼入 URL。 */
export const STREAMING_TRANSCRIPTION_TICKET_ENDPOINT =
  '/v1/client/streaming-transcription/tickets' as const;

/**
 * 同源相对路径约束：`/` 开头、非 protocol-relative（`//`）、不含 `scheme://`。
 * 绝对 URL（http/https/ws 等）会让 bearer 被发往配置指向的任意地址；
 * 浏览器侧凭证只允许投递到同源固定 BFF endpoint。
 */
const SAME_ORIGIN_ENDPOINT_PATTERN = /^\/(?!\/)/;

/** 校验 endpoint 是否可安全携带凭证（同源相对路径）。 */
export function isValidTicketEndpoint(endpoint: string): boolean {
  return (
    SAME_ORIGIN_ENDPOINT_PATTERN.test(endpoint) && !endpoint.includes('://')
  );
}

/** ticket 请求失败的错误面：稳定码 + 可选的稳定服务端 error code。 */
export type StreamingTranscriptionTicketErrorCode =
  'NETWORK_ERROR' | 'HTTP_ERROR' | 'INVALID_RESPONSE';

/** 短时握手凭证；调用方（transport）握手后必须立即丢弃。 */
export interface StreamingTranscriptionTicketGrant {
  readonly ticket: string;
  readonly expiresAt: string;
}

/**
 * 受认证 ticket client 接口。V17 可注入 BFF 实现（服务端持有 bearer 的
 * route handler），测试注入 fake；transport 只依赖本接口。
 */
export interface StreamingTranscriptionTicketClient {
  requestTicket(input: {
    notebookId: string;
    signal?: AbortSignal;
  }): Promise<StreamingTranscriptionTicketGrant>;
}

export interface StreamingTranscriptionTicketClientOptions {
  /**
   * 浏览器 fetch 实现；构造时注入。缺省取全局 fetch——模块顶层不触碰
   * window，SSR 导入安全（node 18+ 全局自带 fetch）。
   */
  fetchImpl?: typeof fetch;
  /** ticket 端点；默认 Gateway 路径（固定，不携带任何凭证）。 */
  endpoint?: string;
  /**
   * 长时 session bearer 的唯一合法去向：只附加到 HTTPS ticket 请求头。
   * 字符串或惰性提供器（避免模块顶层持有凭证）。
   */
  bearer?: string | (() => string | null);
  /** 脱敏日志 sink：只含受控标签与稳定 code，绝不记录凭证。 */
  log?: (entry: { label: string; code?: string }) => void;
}

/** ticket 请求失败：只暴露稳定错误面，不携带响应体/头/自由消息。 */
export class StreamingTranscriptionTicketError extends Error {
  override readonly name = 'StreamingTranscriptionTicketError';

  constructor(
    readonly code: StreamingTranscriptionTicketErrorCode,
    /** 服务端返回的稳定 error code（如 UNAUTHENTICATED）；解析失败时 null。 */
    readonly serverCode: string | null = null,
  ) {
    super(code);
  }
}

/** 201 响应的严格契约：额外键一律拒绝（防止服务端夹带字段进入客户端）。 */
const ticketGrantSchema = z
  .object({
    ticket: z.string().min(1).max(4_096),
    expiresAt: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value)), '非法时间'),
  })
  .strict();

/**
 * 默认受认证 ticket client：POST 固定端点，Authorization 头只在此请求
 * 出现。任何失败抛 `StreamingTranscriptionTicketError`（稳定码）。
 */
export function createStreamingTranscriptionTicketClient(
  options: StreamingTranscriptionTicketClientOptions = {},
): StreamingTranscriptionTicketClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const endpoint = options.endpoint ?? STREAMING_TRANSCRIPTION_TICKET_ENDPOINT;
  if (!isValidTicketEndpoint(endpoint)) {
    // 配置错误立即失败（fail fast）：bearer 只允许投递到同源相对路径。
    throw new TypeError('ticket endpoint 必须是同源相对路径');
  }
  const log = options.log ?? (() => undefined);

  const resolveBearer = (): string | null => {
    const value = options.bearer;
    if (typeof value === 'function') return value();
    return value ?? null;
  };

  return {
    async requestTicket({ notebookId, signal }) {
      const notebookIdResult = gatewayOpaqueIdSchema.safeParse(notebookId);
      if (!notebookIdResult.success) {
        // 服务端仍会权威校验；本地先行拒绝明显非法输入，避免把任意
        // 字符串送进凭证请求。
        log({ label: 'ticket_invalid_notebook', code: 'INVALID_REQUEST' });
        throw new StreamingTranscriptionTicketError('INVALID_RESPONSE');
      }
      const bearer = resolveBearer();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      // 长时 bearer 唯一合法用途：HTTPS ticket 请求。不进入 URL、日志与
      // WebSocket 握手。
      if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ notebookId }),
          signal,
          cache: 'no-store',
        });
      } catch {
        log({ label: 'ticket_network_error', code: 'NETWORK_ERROR' });
        throw new StreamingTranscriptionTicketError('NETWORK_ERROR');
      }
      if (!response.ok) {
        // 只提取稳定 error code（如 UNAUTHENTICATED / NOT_FOUND /
        // STREAMING_TRANSCRIPTION_UNAVAILABLE），绝不记录响应体。
        let serverCode: string | null = null;
        try {
          const parsed = (await response.json()) as {
            error?: { code?: unknown };
          };
          if (typeof parsed.error?.code === 'string') {
            serverCode = parsed.error.code;
          }
        } catch {
          // 非 JSON 错误响应：仍按稳定 HTTP_ERROR 失败，不携带原文。
        }
        log({ label: 'ticket_http_error', code: 'HTTP_ERROR' });
        throw new StreamingTranscriptionTicketError('HTTP_ERROR', serverCode);
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        log({ label: 'ticket_invalid_response', code: 'INVALID_RESPONSE' });
        throw new StreamingTranscriptionTicketError('INVALID_RESPONSE');
      }
      const grant = ticketGrantSchema.safeParse(parsed);
      if (!grant.success) {
        log({ label: 'ticket_invalid_response', code: 'INVALID_RESPONSE' });
        throw new StreamingTranscriptionTicketError('INVALID_RESPONSE');
      }
      log({ label: 'ticket_issued' });
      return grant.data;
    },
  };
}
