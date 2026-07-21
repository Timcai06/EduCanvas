import {
  gatewayClientTurnRequestSchema,
  gatewayConnectionConnectRequestSchema,
  gatewayConnectionConnectResultSchema,
  gatewayConnectionListSchema,
  gatewayConnectionRevokeRequestSchema,
  gatewayConnectionRevokeResultSchema,
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
  gatewayOperationEventSchema,
  type GatewayClientTurnRequest,
  type GatewayConnectionConnectResult,
  type GatewayConnectionList,
  type GatewayConnectionProvider,
  type GatewayConnectionRevokeResult,
  type GatewayHandoffCredential,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { z } from 'zod';

const bootstrapResponseSchema = z
  .object({
    userId: z.string().min(1),
    agentId: z.string().min(1),
    token: z.string().min(32),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const conversationSchema = z
  .object({
    notebookId: z.string().min(1),
    conversationId: z.string().min(1),
    title: z.string().nullable(),
    agentProfileId: z.string().min(1),
    membershipRole: z.enum(['owner', 'editor', 'contributor', 'viewer']),
  })
  .strict();

const directorySchema = z
  .object({ conversations: z.array(conversationSchema) })
  .strict();

const resumeSchema = z
  .object({ events: z.array(gatewayOperationEventSchema) })
  .strict();

const pendingApprovalSchema = z
  .object({
    approvalId: z.string().min(1),
    operationId: z.string().min(1),
    capability: z.string().min(1),
    risk: z.enum(['l2', 'l3']),
    summary: z.string().min(1),
    requestedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export class GatewayClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Gateway request failed: ${code}`);
    this.name = 'GatewayClientError';
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Gateway URL must be HTTP(S) without embedded credentials');
  }
  return url.toString().replace(/\/$/, '');
}

async function parseError(response: Response): Promise<GatewayClientError> {
  let code = 'GATEWAY_REQUEST_FAILED';
  try {
    const value = (await response.json()) as { error?: { code?: unknown } };
    if (
      typeof value.error?.code === 'string' &&
      value.error.code.length <= 128
    ) {
      code = value.error.code;
    }
  } catch {
    // Response bodies are intentionally not reflected into errors.
  }
  return new GatewayClientError(response.status, code);
}

export interface GatewayBootstrapSession {
  userId: string;
  agentId: string;
  token: string;
  expiresAt: string;
}

const recentOperationSchema = z
  .object({
    operationId: z.string().min(1),
    conversationId: z.string().min(1),
    conversationTitle: z.string().nullable(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

const cancelResultSchema = z
  .object({
    status: z.enum([
      'cancelling',
      'not_running',
      'completed',
      'failed',
      'cancelled',
    ]),
  })
  .strict();

export type GatewayConversationEntry = z.infer<typeof conversationSchema>;
export type GatewayPendingApproval = z.infer<typeof pendingApprovalSchema>;
export type GatewayRecentOperation = z.infer<typeof recentOperationSchema>;
export type GatewayCancelResult = z.infer<typeof cancelResultSchema>;

export class GatewayBootstrapClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async bootstrap(
    userId: string,
    bootstrapToken: string,
  ): Promise<GatewayBootstrapSession> {
    const response = await this.fetcher(`${this.baseUrl}/v1/client/bootstrap`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bootstrapToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) throw await parseError(response);
    return bootstrapResponseSchema.parse(await response.json());
  }

  async onboardLocal(): Promise<GatewayBootstrapSession> {
    const response = await this.fetcher(`${this.baseUrl}/v1/local/onboard`, {
      method: 'POST',
    });
    if (!response.ok) throw await parseError(response);
    return bootstrapResponseSchema.parse(await response.json());
  }
}

export class GatewayClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (!token || token.length > 4_096)
      throw new Error('Invalid session token');
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  async listConversations(): Promise<readonly GatewayConversationEntry[]> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/conversations`,
      { headers: this.headers() },
    );
    if (!response.ok) throw await parseError(response);
    return directorySchema.parse(await response.json()).conversations;
  }

  /**
   * 为当前主体拥有的 Conversation 请求短期一次性 Web 交接凭证。
   * 返回值只能立即用于 `/open?token=...`，不得缓存为身份或长期深链。
   */
  async createHandoff(
    conversationId: string,
  ): Promise<GatewayHandoffCredential> {
    const body = gatewayHandoffIssueRequestSchema.parse({ conversationId });
    const response = await this.fetcher(`${this.baseUrl}/v1/client/handoffs`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await parseError(response);
    return gatewayHandoffCredentialSchema.parse(await response.json());
  }

  /** 列出服务端 Provider 能力目录与当前主体自己的连接，不接受客户端 userId。 */
  async listConnections(): Promise<GatewayConnectionList> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/connections`,
      { headers: this.headers() },
    );
    if (!response.ok) throw await parseError(response);
    return gatewayConnectionListSchema.parse(await response.json());
  }

  /** 为一个已拥有的 Conversation 发起外部渠道授权，不直接提交外部账号 ID。 */
  async connect(
    provider: GatewayConnectionProvider,
    conversationId: string,
  ): Promise<GatewayConnectionConnectResult> {
    const body = gatewayConnectionConnectRequestSchema.parse({
      provider,
      conversationId,
    });
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/connections/connect`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw await parseError(response);
    return gatewayConnectionConnectResultSchema.parse(await response.json());
  }

  /** 撤销当前主体自己的连接；服务端再次做租户校验并保留 revokedAt 审计。 */
  async revokeConnection(
    connectionId: string,
  ): Promise<GatewayConnectionRevokeResult> {
    const body = gatewayConnectionRevokeRequestSchema.parse({ connectionId });
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/connections/revoke`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw await parseError(response);
    return gatewayConnectionRevokeResultSchema.parse(await response.json());
  }

  async listApprovals(): Promise<readonly GatewayPendingApproval[]> {
    const response = await this.fetcher(`${this.baseUrl}/v1/client/approvals`, {
      headers: this.headers(),
    });
    if (!response.ok) throw await parseError(response);
    return z
      .object({ approvals: z.array(pendingApprovalSchema) })
      .strict()
      .parse(await response.json()).approvals;
  }

  async resolveApproval(
    approvalId: string,
    status: 'approved' | 'denied',
    reason?: string,
  ): Promise<void> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      },
    );
    if (!response.ok) throw await parseError(response);
    await response.body?.cancel();
  }

  /**
   * 流式发起一轮对话。`options.signal` 中止本地读流（离开实时视图）；
   * 真正取消服务端操作请用 `cancelOperation`，其 `operation.cancelled`
   * 会经本流回来。二者独立：signal 只影响本地，不触达服务端。
   */
  async *streamTurn(
    request: GatewayClientTurnRequest,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<GatewayOperationEvent> {
    const body = gatewayClientTurnRequestSchema.parse(request);
    const response = await this.fetcher(`${this.baseUrl}/v1/client/turns`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw await parseError(response);
    if (!response.body) throw new GatewayClientError(502, 'EMPTY_STREAM');
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = '';
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += next.value;
        if (buffer.length > 1_000_000) {
          throw new GatewayClientError(502, 'STREAM_FRAME_TOO_LARGE');
        }
        while (true) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) yield gatewayOperationEventSchema.parse(JSON.parse(line));
        }
      }
      if (buffer.trim()) {
        yield gatewayOperationEventSchema.parse(JSON.parse(buffer));
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** 近期回合操作，供会话恢复入口列出可 resume 的历史。 */
  async listOperations(): Promise<readonly GatewayRecentOperation[]> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/operations`,
      {
        headers: this.headers(),
      },
    );
    if (!response.ok) throw await parseError(response);
    return z
      .object({ operations: z.array(recentOperationSchema) })
      .strict()
      .parse(await response.json()).operations;
  }

  /**
   * 请求取消一个运行中操作。服务端追加 `operation.cancelled` 并经既有事件流
   * 回到正在读流的客户端；本方法只返回请求受理结果，不代表终态已写入。
   */
  async cancelOperation(operationId: string): Promise<GatewayCancelResult> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/operations/${encodeURIComponent(operationId)}/cancel`,
      { method: 'POST', headers: this.headers() },
    );
    if (!response.ok) throw await parseError(response);
    /* response.json() 已读尽并锁定 body，不能再 cancel()（否则 ERR_INVALID_STATE）。 */
    return cancelResultSchema.parse(await response.json());
  }

  async resume(
    operationId: string,
    afterSequence = -1,
  ): Promise<readonly GatewayOperationEvent[]> {
    const url = new URL(
      `${this.baseUrl}/v1/client/operations/${encodeURIComponent(operationId)}/events`,
    );
    url.searchParams.set('after', String(afterSequence));
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw await parseError(response);
    return resumeSchema.parse(await response.json()).events;
  }
}
