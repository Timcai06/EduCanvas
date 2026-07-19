import { describe, expect, it, vi } from 'vitest';
import {
  normalizeTelegramUpdate,
  sendTelegramText,
  telegramTextChunks,
  type TelegramPrivateBinding,
} from './adapter';

const binding: TelegramPrivateBinding = {
  accountBindingId: 'binding:account',
  threadBindingId: 'binding:thread',
  externalUserId: '42',
  externalThreadId: '42',
  userId: 'user:1',
  agentId: 'agent:1',
  notebookId: 'notebook:1',
  conversationId: 'conversation:1',
};

const update = {
  update_id: 100,
  message: {
    message_id: 9,
    from: { id: 42, is_bot: false, first_name: 'Ada' },
    chat: { id: 42, type: 'private', first_name: 'Ada' },
    date: 1_753_000_000,
    text: '解释光合作用',
  },
};

describe('Telegram channel adapter', () => {
  it('normalizes paired private text and uses update_id for deduplication', () => {
    const result = normalizeTelegramUpdate(update, binding);
    expect(result).toMatchObject({
      ok: true,
      envelope: {
        envelopeId: 'telegram:update:100',
        idempotencyKey: 'telegram:100',
        principal: { userId: 'user:1' },
      },
    });
  });

  it('rejects groups, bots, unknown accounts and unsupported media', () => {
    expect(
      normalizeTelegramUpdate(
        {
          ...update,
          message: { ...update.message, chat: { id: -1, type: 'group' } },
        },
        binding,
      ),
    ).toMatchObject({ code: 'GROUP_CHAT_REJECTED' });
    expect(
      normalizeTelegramUpdate(
        {
          ...update,
          message: { ...update.message, from: { id: 42, is_bot: true } },
        },
        binding,
      ),
    ).toMatchObject({ code: 'BOT_MESSAGE_REJECTED' });
    expect(normalizeTelegramUpdate(update, null)).toMatchObject({
      code: 'UNPAIRED_ACCOUNT',
    });
    expect(
      normalizeTelegramUpdate(
        {
          ...update,
          message: { ...update.message, text: undefined, photo: [] },
        },
        binding,
      ),
    ).toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
  });

  it('chunks output at Telegram sendMessage limits and never sets parse_mode', async () => {
    const events = [
      {
        protocol: 'gateway.v1' as const,
        eventId: 'event:1',
        operationId: 'operation:1',
        sequence: 0,
        occurredAt: '2026-07-19T04:00:00.000Z',
        type: 'message.delta' as const,
        delta: 'x'.repeat(4_500),
      },
    ];
    const chunks = telegramTextChunks(events);
    expect(chunks).toHaveLength(2);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('parse_mode');
      return Response.json({ ok: true, result: { message_id: 7 } });
    });
    await sendTelegramText({
      botToken: 'secret',
      chatId: '42',
      text: chunks[0]!,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
