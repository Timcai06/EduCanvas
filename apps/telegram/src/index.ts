import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  normalizeTelegramUpdate,
  sendTelegramText,
  telegramTextChunks,
  type TelegramPrivateBinding,
} from '@educanvas/channel-telegram';
import {
  DrizzleGatewayChannelBindingRepository,
  DrizzleGatewayDeliveryRepository,
} from '@educanvas/db';
import {
  gatewayOperationEventSchema,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';

const bindings = new DrizzleGatewayChannelBindingRepository();
const deliveries = new DrizzleGatewayDeliveryRepository();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function gatewayEvents(
  baseUrl: string,
  token: string,
  envelope: GatewayInboundEnvelope,
): Promise<readonly GatewayOperationEvent[]> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/v1/internal/envelopes`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope),
    },
  );
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Gateway rejected Telegram update with HTTP ${response.status}`,
    );
  }
  const text = await response.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => gatewayOperationEventSchema.parse(JSON.parse(line)));
}

function telegramIds(raw: unknown): { userId: string; chatId: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = (raw as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const from = (message as { from?: unknown }).from;
  const chat = (message as { chat?: unknown }).chat;
  if (!from || typeof from !== 'object' || !chat || typeof chat !== 'object') {
    return null;
  }
  const userId = (from as { id?: unknown }).id;
  const chatId = (chat as { id?: unknown }).id;
  return typeof userId === 'number' && typeof chatId === 'number'
    ? { userId: String(userId), chatId: String(chatId) }
    : null;
}

async function processUpdate(input: {
  raw: unknown;
  botToken: string;
  gatewayUrl: string;
  gatewayToken: string;
}): Promise<void> {
  const ids = telegramIds(input.raw);
  const binding = ids
    ? await bindings.resolvePrivate({
        adapterId: 'telegram.bot',
        externalUserId: ids.userId,
        externalThreadId: ids.chatId,
      })
    : null;
  const normalized = normalizeTelegramUpdate(input.raw, binding);
  if (!normalized.ok) return;
  const events = await gatewayEvents(
    input.gatewayUrl,
    input.gatewayToken,
    normalized.envelope,
  );
  const operationId = events[0]?.operationId;
  if (!operationId || !ids) return;
  const delivery = await deliveries.begin({
    operationId,
    envelopeId: normalized.envelope.envelopeId,
    targetKind: 'channel',
    target: { adapterId: 'telegram.bot', threadId: ids.chatId },
  });
  if (delivery.replayed) return;
  let chunks = telegramTextChunks(events);
  if (
    chunks.length === 0 &&
    events.some((event) => event.type === 'operation.failed')
  ) {
    chunks = ['EduCanvas 暂时无法完成这次请求，请稍后重试。'];
  }
  if (events.some((event) => event.type === 'approval.required')) {
    chunks = [
      '这项操作需要更高权限，请在 Web 或 TUI 中审批；Telegram 私聊不会直接批准高风险操作。',
    ];
  }
  try {
    let externalMessageId: string | null = null;
    for (const text of chunks) {
      externalMessageId = await sendTelegramText({
        botToken: input.botToken,
        chatId: ids.chatId,
        text,
      });
    }
    await deliveries.settle({
      deliveryId: delivery.deliveryId,
      status: 'acknowledged',
      externalMessageId,
    });
  } catch (error) {
    await deliveries.settle({
      deliveryId: delivery.deliveryId,
      status: 'failed',
      failureCode: 'DELIVERY_FAILED',
    });
    throw error;
  }
}

async function run(): Promise<void> {
  const botToken = required('TELEGRAM_BOT_TOKEN');
  const gatewayUrl = required('EDUCANVAS_GATEWAY_URL');
  const gatewayToken = required('EDUCANVAS_GATEWAY_INTERNAL_TOKEN');
  let offset = 0;
  while (true) {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          offset,
          limit: 20,
          timeout: 25,
          allowed_updates: ['message'],
        }),
      },
    );
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Telegram getUpdates failed with HTTP ${response.status}`,
      );
    }
    const body = (await response.json()) as { ok?: unknown; result?: unknown };
    if (body.ok !== true || !Array.isArray(body.result)) {
      throw new Error('Telegram getUpdates returned an invalid response');
    }
    for (const raw of body.result) {
      await processUpdate({ raw, botToken, gatewayUrl, gatewayToken });
      const updateId =
        raw && typeof raw === 'object'
          ? (raw as { update_id?: unknown }).update_id
          : null;
      if (typeof updateId === 'number' && Number.isInteger(updateId)) {
        offset = Math.max(offset, updateId + 1);
      }
    }
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'bind') {
    const [userId, telegramUserId, conversationId] = args;
    if (!userId || !telegramUserId || !conversationId) {
      throw new Error('bind requires userId telegramUserId conversationId');
    }
    const binding = await bindings.bindPrivate({
      adapterId: 'telegram.bot',
      externalUserId: telegramUserId,
      externalThreadId: telegramUserId,
      userId,
      conversationId,
    });
    process.stdout.write(`${binding.threadBindingId}\n`);
    return;
  }
  if (command === 'validate-fixture') {
    const [updatePath, bindingPath] = args;
    if (!updatePath || !bindingPath) {
      throw new Error('validate-fixture requires update.json binding.json');
    }
    const [raw, binding] = await Promise.all([
      readFile(updatePath, 'utf8').then(JSON.parse),
      readFile(bindingPath, 'utf8').then(
        (value) => JSON.parse(value) as TelegramPrivateBinding,
      ),
    ]);
    process.stdout.write(
      `${JSON.stringify(normalizeTelegramUpdate(raw, binding), null, 2)}\n`,
    );
    return;
  }
  if (command === 'run') return run();
  throw new Error('expected run, bind, or validate-fixture command');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`[telegram] ${message}\n`);
  process.exitCode = 1;
});
