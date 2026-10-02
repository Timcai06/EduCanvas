import {
  gatewayAssetSnapshotSchema,
  gatewayClientTurnRequestSchema,
  gatewayConversationCreateRequestSchema,
  gatewayDesktopCapabilityManifest,
  gatewayConversationCreateResultSchema,
  gatewayConversationDirectoryCursorSchema,
  gatewayConversationDirectoryPageSchema,
  gatewayConnectionConnectRequestSchema,
  gatewayConnectionConnectResultSchema,
  gatewayConnectionListSchema,
  gatewayConnectionRevokeRequestSchema,
  gatewayConnectionRevokeResultSchema,
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
  gatewayMessageHistoryCursorSchema,
  gatewayMessageHistoryPageSchema,
  gatewayOperationEventSchema,
  type GatewayAssetSnapshot,
  type GatewayClientTurnRequest,
  type GatewayConversationCreateRequest,
  type GatewayConversationCreateResult,
  type GatewayConversationDirectoryPage,
  type GatewayConnectionConnectResult,
  type GatewayConnectionList,
  type GatewayConnectionProvider,
  type GatewayConnectionRevokeResult,
  type GatewayHandoffCredential,
  type GatewayHandoffTarget,
  type GatewayMessageHistoryEntry,
  type GatewayMessageHistoryPage,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import {
  canvasResourceKindSchema,
  canvasResourceSchema,
  type CanvasResource,
  type CanvasResourceKind,
} from '@educanvas/canvas-protocol';
import { z } from 'zod';

/**
 * 客户端侧的职责仅限：校验入参、发起 HTTP(S) 调用、解析回包并保持边界。
 * 所有会话建立、鉴权强制、路由决策都在网关服务端完成。
 */
const bootstrapResponseSchema = z
  .object({
    userId: z.string().min(1),
    agentId: z.string().min(1),
    token: z.string().min(32),
    expiresAt: z.string().datetime({ offset: true }),
  })
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

/**
 * 统一入口 URL 规范化：去掉末尾斜杠、拒绝内嵌 credential（user:pass@host）。
 * 这样可防止凭据被日志/代理记录到 URL 上。
 */
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

/**
 * 统一错误解析：读取网关报文里的 code（长度上限）作为机器可读错误码。
 * 失败体不直接透传，避免把上游诊断细节带入客户端异常文本。
 */
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

const IMAGE_PREVIEW_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const MAX_IMAGE_PREVIEW_BYTES = 1_000_000;

export type GatewayConversationEntry = Pick<
  GatewayConversationDirectoryPage['conversations'][number],
  | 'notebookId'
  | 'conversationId'
  | 'title'
  | 'agentProfileId'
  | 'membershipRole'
>;
export type GatewayPendingApproval = z.infer<typeof pendingApprovalSchema>;
export type GatewayRecentOperation = z.infer<typeof recentOperationSchema>;
export type GatewayCancelResult = z.infer<typeof cancelResultSchema>;
export interface GatewayImagePreview {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  bytes: Uint8Array;
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
      throw new GatewayClientError(502, 'INVALID_IMAGE_PREVIEW');
    if (declaredLength > maxBytes)
      throw new GatewayClientError(502, 'IMAGE_PREVIEW_TOO_LARGE');
  }
  if (!response.body) throw new GatewayClientError(502, 'EMPTY_IMAGE_PREVIEW');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maxBytes)
        throw new GatewayClientError(502, 'IMAGE_PREVIEW_TOO_LARGE');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * bootstrap/onboard 只用于换取短期 session token。
 * 客户端层不承担任何用户绑定或凭据派发校验，交给服务端统一决策。
 */
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

/**
 * GatewayClient 所有请求都依赖固定 session token。
 * token 只允许通过 Authorization 头传输，不允许进入 URL、body 或日志中间件默认可见区。
 */
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

  async listConversationPage(
    input: { limit?: number; cursor?: string } = {},
  ): Promise<GatewayConversationDirectoryPage> {
    const url = new URL(`${this.baseUrl}/v1/client/conversations`);
    if (input.limit !== undefined) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)
        throw new Error('Invalid conversation page size');
      url.searchParams.set('limit', String(input.limit));
    }
    if (input.cursor !== undefined) {
      url.searchParams.set(
        'cursor',
        gatewayConversationDirectoryCursorSchema.parse(input.cursor),
      );
    }
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw await parseError(response);
    return gatewayConversationDirectoryPageSchema.parse(await response.json());
  }

  async listConversations(): Promise<readonly GatewayConversationEntry[]> {
    const conversations: GatewayConversationEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listConversationPage({ limit: 50, cursor });
      conversations.push(...page.conversations);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return conversations;
  }

  async createConversation(
    input: GatewayConversationCreateRequest,
  ): Promise<GatewayConversationCreateResult> {
    const body = gatewayConversationCreateRequestSchema.parse(input);
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/conversations`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw await parseError(response);
    return gatewayConversationCreateResultSchema.parse(await response.json());
  }

  async listMessagePage(input: {
    conversationId: string;
    limit?: number;
    cursor?: string;
  }): Promise<GatewayMessageHistoryPage> {
    const url = new URL(
      `${this.baseUrl}/v1/client/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    );
    if (input.limit !== undefined) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        throw new Error('Invalid message page size');
      url.searchParams.set('limit', String(input.limit));
    }
    if (input.cursor !== undefined) {
      url.searchParams.set(
        'cursor',
        gatewayMessageHistoryCursorSchema.parse(input.cursor),
      );
    }
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw await parseError(response);
    return gatewayMessageHistoryPageSchema.parse(await response.json());
  }

  async listMessages(
    conversationId: string,
  ): Promise<readonly GatewayMessageHistoryEntry[]> {
    const messages: GatewayMessageHistoryEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listMessagePage({
        conversationId,
        limit: 100,
        cursor,
      });
      messages.push(...page.messages);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return messages;
  }

  /**
   * 读取当前 bearer 主体在该 Conversation 中可见的图片缩略图。
   * 私有存储地址从不离开 Gateway；这里仅接收受限大小的二进制响应。
   */
  async getImagePreview(input: {
    conversationId: string;
    assetId: string;
    assetVersionId: string;
  }): Promise<GatewayImagePreview> {
    for (const value of [
      input.conversationId,
      input.assetId,
      input.assetVersionId,
    ]) {
      if (!value || value.length > 256)
        throw new Error('Invalid image preview selector');
    }
    const response = await this.fetcher(
      `${this.baseUrl}/v1/client/conversations/${encodeURIComponent(input.conversationId)}/assets/${encodeURIComponent(input.assetId)}/versions/${encodeURIComponent(input.assetVersionId)}/image-preview`,
      { headers: this.headers() },
    );
    if (!response.ok) throw await parseError(response);

    const mimeType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!mimeType || !IMAGE_PREVIEW_MIME_TYPES.has(mimeType))
      throw new GatewayClientError(502, 'INVALID_IMAGE_PREVIEW');

    return {
      mimeType: mimeType as GatewayImagePreview['mimeType'],
      bytes: await readBoundedBytes(response, MAX_IMAGE_PREVIEW_BYTES),
    };
  }

  /**
   * 列出服务端按当前 bearer 主体与 Notebook 重新授权后的 CanvasResource。
   * 客户端传入的 notebookId 只是选择器，不是访问凭据。
   */
  async listCanvasResources(
    notebookId: string,
  ): Promise<readonly CanvasResource[]> {
    const url = new URL(`${this.baseUrl}/v1/client/canvas-resources`);
    url.searchParams.set('notebookId', notebookId);
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw await parseError(response);
    return z
      .object({ resources: z.array(canvasResourceSchema).max(100) })
      .strict()
      .parse(await response.json()).resources;
  }

  async getCanvasResource(input: {
    notebookId: string;
    resourceKind: CanvasResourceKind;
    resourceId: string;
  }): Promise<CanvasResource> {
    const resourceKind = canvasResourceKindSchema.parse(input.resourceKind);
    const url = new URL(
      `${this.baseUrl}/v1/client/canvas-resources/${resourceKind}/${encodeURIComponent(input.resourceId)}`,
    );
    url.searchParams.set('notebookId', input.notebookId);
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw await parseError(response);
    return canvasResourceSchema.parse(await response.json());
  }

  /**
   * 把桌面选中的图片/PDF 上传到当前 Notebook（DP10）。multipart 里带 file 与
   * scope；服务端按 bearer 主体 + notebookId 做归属校验后落库（图片即 ready，
   * PDF 为 processing 待 worker 提取）。返回 `GatewayAssetSnapshot` 投影。
   */
  async uploadAsset(input: {
    notebookId: string;
    file: File;
    scope: 'turn' | 'space';
  }): Promise<GatewayAssetSnapshot> {
    if (input.scope !== 'turn' && input.scope !== 'space') {
      throw new Error('Invalid asset scope');
    }
    const url = new URL(`${this.baseUrl}/v1/client/assets`);
    url.searchParams.set('notebookId', input.notebookId);
    const form = new FormData();
    form.append('file', input.file);
    form.append('scope', input.scope);
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!response.ok) throw await parseError(response);
    return gatewayAssetSnapshotSchema.parse(await response.json());
  }

  /**
   * 按 bearer 主体 + notebookId 轮询已上传资产的当前快照（DP10 ready-wait）。
   * 调用方据此读取 `descriptor.status` 直至 ready/failed，并取得当前版本号。
   */
  async getAsset(input: {
    assetId: string;
    notebookId: string;
  }): Promise<GatewayAssetSnapshot> {
    const url = new URL(
      `${this.baseUrl}/v1/client/assets/${encodeURIComponent(input.assetId)}`,
    );
    url.searchParams.set('notebookId', input.notebookId);
    const response = await this.fetcher(url, { headers: this.headers() });
    if (!response.ok) throw await parseError(response);
    return gatewayAssetSnapshotSchema.parse(await response.json());
  }

  /**
   * 为当前主体拥有的 Conversation 请求短期一次性 Web 交接凭证。
   * `target` 可选：缺省为 conversation 级（DP07 语义）；携带时把精确资源
   * 目标（message/artifact/resource）下沉到凭证，服务端在 issue 时重验归属。
   * 返回值只能立即用于 `/open?token=...`，不得缓存为身份或长期深链。
   */
  async createHandoff(
    conversationId: string,
    target?: GatewayHandoffTarget,
  ): Promise<GatewayHandoffCredential> {
    const body = gatewayHandoffIssueRequestSchema.parse(
      target ? { conversationId, target } : { conversationId },
    );
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
   *
   * 解析策略：
   * - JSON 按行解析 NDJSON，允许最后一条无换行；
   * - 缓冲区上限 1_000_000 字节，防止恶意超长帧；
   * - 每条 event 都经过 schema 校验；无效 JSON 或 schema 不匹配会抛异常中断消费。
   */
  async *streamTurn(
    request: Omit<GatewayClientTurnRequest, 'capabilities'>,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<GatewayOperationEvent> {
    // GatewayClient 是桌面第一方客户端：Turn 恒携带冻结的桌面 v1 capability manifest
    // （DP06）。risk/version 由服务端解析，客户端只显式声明能力名，调用方无需重复携带。
    const body = gatewayClientTurnRequestSchema.parse({
      ...request,
      capabilities: gatewayDesktopCapabilityManifest,
    });
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
