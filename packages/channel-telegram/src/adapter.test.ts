import { describe, expect, it, vi } from 'vitest';
import {
  normalizeTelegramUpdate,
  projectTelegramOperation,
  readTelegramConnectionActivation,
  sendTelegramText,
  telegramTextChunks,
  type TelegramPrivateBinding,
} from './adapter';

/**
 * Telegram 适配器测试关注“边界先行”：
 * 1) 入站 update 必须通过标准化和配对校验；
 * 2) 不把连接握手当做授权；
 * 3) 下行发送仅做 transport 安全约束（分包/无 parse_mode）。
 */

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

  it('extracts a private start code but leaves authorization to server state', () => {
    const connectionId = '9e4251d2-e87b-4a5b-8d25-59cae5a21539';
    expect(
      readTelegramConnectionActivation({
        ...update,
        message: {
          ...update.message,
          text: `/start educanvas_${connectionId}`,
        },
      }),
    ).toEqual({
      connectionId,
      externalAccountId: '42',
      externalThreadId: '42',
    });
    expect(
      readTelegramConnectionActivation({
        ...update,
        message: { ...update.message, text: '/start attacker-chosen' },
      }),
    ).toBeNull();
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

  it('把取消、能力不可用、Runtime失败与审批投影为明确安全降级', async () => {
    const { gatewayCrossEntryConformance } =
      await import('../../../tooling/test-fixtures/gateway-cross-entry-conformance');

    expect(
      projectTelegramOperation(gatewayCrossEntryConformance.cancelled),
    ).toMatchObject({ status: 'cancelled' });
    expect(
      projectTelegramOperation(
        gatewayCrossEntryConformance.capabilityUnavailable,
      ),
    ).toMatchObject({
      status: 'failed',
      code: 'CAPABILITY_UNAVAILABLE',
      retryable: false,
    });
    expect(
      projectTelegramOperation(gatewayCrossEntryConformance.runtimeFailed),
    ).toMatchObject({ status: 'failed', code: 'RUNTIME_FAILED' });
    expect(
      projectTelegramOperation(gatewayCrossEntryConformance.approvalPending),
    ).toMatchObject({ status: 'approval_required' });
    expect(
      projectTelegramOperation(gatewayCrossEntryConformance.completed),
    ).toBeNull();
  });
});
