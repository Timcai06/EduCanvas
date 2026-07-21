import {
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { z } from 'zod';

const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
});
const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.string(),
});
const telegramMessageSchema = z.object({
  message_id: z.number().int().nonnegative(),
  message_thread_id: z.number().int().positive().optional(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number().int().nonnegative(),
  text: z.string().max(4_096).optional(),
});
const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: telegramMessageSchema.optional(),
});

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
 * 返回值仍不是授权结论；Adapter 必须交给服务端 pending 仓储校验到期、重放与归属。
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
