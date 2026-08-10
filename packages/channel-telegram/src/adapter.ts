import {
  gatewayProtocolVersion,
  type GatewayFailureCode,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { z } from 'zod';

/**
 * 适配器输入是 Telegram Bot API 的原始消息：字段会被截断、重复或伪造。
 * 所有 schema 校验都在这里先行，任何不满足的更新都在 transport 层被挡掉。
 */
const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
});

/**
 * Telegram chat 结构仅用于接入层安全判断（如仅允许私聊）；
 * 不把 `type` 之外的字段扩展到上层，以避免不必要的供应商耦合。
 */
const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.string(),
});

/**
 * 消息主体限制到文本路径：不支持媒体、转发、签名附件等扩展内容。
 * 这是“输入面最小化”策略之一，复杂媒体由专用通道处理。
 */
const telegramMessageSchema = z.object({
  message_id: z.number().int().nonnegative(),
  message_thread_id: z.number().int().positive().optional(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number().int().nonnegative(),
  text: z.string().max(4_096).optional(),
});

/**
 * 仅接受基本更新壳；更新 ID 仍用于幂等 key，但不会被外部信任，最后一层再绑定服务端会话。
 */
const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: telegramMessageSchema.optional(),
});

/**
 * 绑定由服务端仓储查询后注入，避免将外部用户 ID/会话 ID 直接作为可信身份来源。
 */
export interface TelegramPrivateBinding {
  accountBindingId: string;
  threadBindingId: string;
  externalUserId: string;
  externalThreadId: string;
  userId: string;
  agentId: string;
  notebookId: string;
  conversationId: string;
}

export type TelegramNormalizationResult =
  | { ok: true; envelope: GatewayInboundEnvelope }
  | {
      ok: false;
      code:
        | 'INVALID_UPDATE'
        | 'UNSUPPORTED_UPDATE'
        | 'GROUP_CHAT_REJECTED'
        | 'BOT_MESSAGE_REJECTED'
        | 'UNPAIRED_ACCOUNT'
        | 'UNSUPPORTED_CONTENT';
    };

export interface TelegramConnectionActivation {
  connectionId: string;
  externalAccountId: string;
  externalThreadId: string;
}

/**
 * 只从 Telegram 私聊 `/start educanvas_<uuid>` 提取一次性连接确认。
 * 返回值仍不是授权结论；Adapter 只负责识别“启动意图”，
 * 授权、超时、归属校验留给服务端 pending 绑定记录。
 */
export function readTelegramConnectionActivation(
  raw: unknown,
): TelegramConnectionActivation | null {
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data.message;
  if (
    !message?.from ||
    message.from.is_bot ||
    message.chat.type !== 'private' ||
    !message.text
  ) {
    return null;
  }
  const match = message.text
    .trim()
    .match(
      /^\/start(?:@[A-Za-z0-9_]+)?\s+educanvas_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    );
  return match?.[1]
    ? {
        connectionId: match[1],
        externalAccountId: String(message.from.id),
        externalThreadId: String(message.chat.id),
      }
    : null;
}

/**
 * 将一条 Telegram 私聊文本更新标准化为网关入站信封。
 * 约束：
 * - 仅 private + 非 bot + 有文本 + 已绑定用户/会话才能入站；
 * - 使用 update_id 作为幂等键，防止重复交付；
 * - principal/capabilities/routeHint 仅携带服务端可验证字段。
 */
export function normalizeTelegramUpdate(
  raw: unknown,
  binding: TelegramPrivateBinding | null,
  now: Date = new Date(),
): TelegramNormalizationResult {
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_UPDATE' };
  const message = parsed.data.message;
  if (!message || !message.from) {
    return { ok: false, code: 'UNSUPPORTED_UPDATE' };
  }
  if (message.chat.type !== 'private') {
    return { ok: false, code: 'GROUP_CHAT_REJECTED' };
  }
  if (message.from.is_bot) return { ok: false, code: 'BOT_MESSAGE_REJECTED' };
  if (!message.text?.trim()) {
    return { ok: false, code: 'UNSUPPORTED_CONTENT' };
  }
  if (
    !binding ||
    binding.externalUserId !== String(message.from.id) ||
    binding.externalThreadId !== String(message.chat.id)
  ) {
    return { ok: false, code: 'UNPAIRED_ACCOUNT' };
  }
  const updateId = String(parsed.data.update_id);
  const connectionId = `telegram:${binding.threadBindingId}`;
  return {
    ok: true,
    envelope: {
      protocol: gatewayProtocolVersion,
      envelopeId: `telegram:update:${updateId}`,
      idempotencyKey: `telegram:${updateId}`,
      occurredAt: new Date(message.date * 1_000).toISOString(),
      connection: {
        connectionId,
        role: 'channel',
        transport: 'telegram',
        adapterId: 'telegram.bot',
      },
      principal: {
        subjectId: binding.externalUserId,
        userId: binding.userId,
        agentId: binding.agentId,
        kind: 'user',
        authenticationMethod: 'channel_binding',
        authenticatedAt: now.toISOString(),
      },
      routeHint: {
        notebookId: binding.notebookId,
        conversationId: binding.conversationId,
      },
      parts: [{ type: 'text', text: message.text.trim() }],
      capabilities: {
        manifestId: `telegram:${updateId}`,
        issuedAt: now.toISOString(),
        capabilities: [
          { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
          {
            name: 'output.markdown',
            risk: 'l0',
            version: '1',
            constraints: {},
          },
        ],
      },
      replyTarget: {
        kind: 'channel',
        adapterId: 'telegram.bot',
        accountId: binding.accountBindingId,
        threadId: binding.threadBindingId,
      },
    },
  };
}

/**
 * Telegram 下发正文按 Telegram sendMessage 长度与换行边界分包。
 * 使用固定 4,096 字符上限；若通道限制变化，必须同步调整实现与测试；
 * 无内容时返回空数组，避免发送空消息。
 */
export function telegramTextChunks(
  events: readonly GatewayOperationEvent[],
): readonly string[] {
  const text = events
    .filter((event) => event.type === 'message.delta')
    .map((event) => event.delta)
    .join('')
    .trim();
  if (!text) return [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = Math.min(4_096, remaining.length);
    if (end < remaining.length) {
      const boundary = remaining.lastIndexOf('\n', end);
      if (boundary >= 2_048) end = boundary;
    }
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^\n+/, '');
  }
  return chunks;
}

export type TelegramOperationProjection =
  | {
      status: 'approval_required';
      text: string;
    }
  | {
      status: 'cancelled';
      text: string;
    }
  | {
      status: 'failed';
      code: GatewayFailureCode;
      retryable: boolean;
      text: string;
    };

/**
 * 把 Gateway 控制事实投影为 Telegram 的有界文本。结构中保留稳定失败码供
 * 适配器测试与观测使用，但下发文本不暴露内部响应、堆栈或 Provider 细节。
 */
export function projectTelegramOperation(
  events: readonly GatewayOperationEvent[],
): TelegramOperationProjection | null {
  const terminal = events.findLast(
    (event) =>
      event.type === 'operation.completed' ||
      event.type === 'operation.failed' ||
      event.type === 'operation.cancelled',
  );
  if (terminal?.type === 'operation.completed') return null;
  if (terminal?.type === 'operation.cancelled') {
    return { status: 'cancelled', text: '这轮回答已停止。' };
  }
  if (terminal?.type === 'operation.failed') {
    const text =
      terminal.code === 'CAPABILITY_UNAVAILABLE'
        ? '这项能力暂不可用，请改用 Web 或 TUI 查看可用入口。'
        : terminal.code === 'RUNTIME_FAILED'
          ? '这轮运行失败了，可以稍后重试或在 Web 中查看。'
          : 'EduCanvas 暂时无法完成这次请求，请稍后重试。';
    return {
      status: 'failed',
      code: terminal.code,
      retryable: terminal.retryable,
      text,
    };
  }
  if (events.some((event) => event.type === 'approval.required')) {
    return {
      status: 'approval_required',
      text: '这项操作需要更高权限，请在 Web 或 TUI 中审批；Telegram 私聊不会直接批准高风险操作。',
    };
  }
  return null;
}

/**
 * 调用 Bot API 发送文本。
 * 行为边界：
 * - 默认使用全局 fetch，可注入 mock/fetcher 便于测试；
 * - 不向 Telegram 注入 parse_mode，避免客户端富文本行为差异；
 * - 非 2xx 状态直接失败并不泄露响应体。
 */
export async function sendTelegramText(input: {
  botToken: string;
  chatId: string;
  text: string;
  messageThreadId?: number;
  fetcher?: typeof fetch;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://api.telegram.org/bot${input.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        ...(input.messageThreadId
          ? { message_thread_id: input.messageThreadId }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined);
    throw new Error(`Telegram delivery failed with HTTP ${response.status}`);
  }
  const result = z
    .object({
      ok: z.literal(true),
      result: z.object({ message_id: z.number().int().nonnegative() }),
    })
    .parse(await response.json());
  return String(result.result.message_id);
}
