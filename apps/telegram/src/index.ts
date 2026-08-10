import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  normalizeTelegramUpdate,
  projectTelegramOperation,
  readTelegramConnectionActivation,
  sendTelegramText,
  telegramTextChunks,
  type TelegramPrivateBinding,
} from '@educanvas/channel-telegram';
import {
  DrizzleGatewayChannelBindingRepository,
  DrizzleGatewayConnectionRepository,
  DrizzleGatewayDeliveryRepository,
  DrizzlePlatformArtifactRepository,
  requireNotebookAccess,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';
import { projectOwnedArtifactResource } from '@educanvas/canvas-protocol/server';
import {
  gatewayOperationEventSchema,
  validateGatewayEventSequence,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { telegramCanvasSummaries } from './canvas-delivery';

const bindings = new DrizzleGatewayChannelBindingRepository();
const connections = new DrizzleGatewayConnectionRepository();
const deliveries = new DrizzleGatewayDeliveryRepository();
const artifacts = new DrizzlePlatformArtifactRepository();

/**
 * 从 Web 侧 binding 与 artifact 权限入口安全加载 artifact 投影：
 * - 先验证笔记本读权限（trustedSubjectId）
 * - 再核对 artifact 所属 notebook 一致性
 * - 通过 canvas-protocol projectOwnedArtifactResource 生成跨端可展示资源
 * - 无权限/归属不一致返回 null（fail-closed，不抛错）
 */
async function loadTelegramArtifactResource(input: {
  userId: string;
  notebookId: string;
  artifactId: string;
}) {
  const access = await requireNotebookAccess(getDb(), {
    notebookId: input.notebookId,
    trustedSubjectId: input.userId,
    requiredPermission: 'notebook.read',
  }).catch(() => null);
  if (!access) return null;
  const detail = await artifacts.getArtifactDetail({
    artifactId: input.artifactId,
    trustedSubjectId: input.userId,
  });
  if (detail.artifact.spaceId !== input.notebookId) return null;
  return projectOwnedArtifactResource({
    notebookId: input.notebookId,
    artifact: detail.artifact,
    version: detail.latestVersion,
    latestJob: detail.latestJob,
    accessRole: access.role,
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * 将 gateway 入站 envelope 发给网关内部入口，拿到可重放的事件流（NDJSON）。
 * - 非 2xx 直接抛错，避免将网关错误细节回传到 channel
 * - 每行按 schema parse，确保后续逻辑仅处理已校验事件
 */
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
  const events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => gatewayOperationEventSchema.parse(JSON.parse(line)));
  if (!validateGatewayEventSequence(events)) {
    throw new Error('Gateway returned an invalid Telegram event sequence');
  }
  return events;
}

/**
 * 解析 Telegram 更新中的用户与会话 ID；
 * 仅接受数字型 Telegram id，避免污染绑定查找与回执路由。
 */
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

/**
 * 处理单条 Telegram 更新：
 * - 识别并完成 pairing 激活（activation）流程（成功/失败通知）
 * - 未绑定场景直接静默返回
 * - 已绑定场景转发到网关，拿到事件并回写 delivery
 * - 回写失败会更新 delivery 状态为 failed，供上游可观测与重试
 */
async function processUpdate(input: {
  raw: unknown;
  botToken: string;
  gatewayUrl: string;
  gatewayToken: string;
}): Promise<void> {
  const activation = readTelegramConnectionActivation(input.raw);
  if (activation) {
    try {
      await connections.activatePending({
        provider: 'telegram',
        ...activation,
      });
    } catch {
      await sendTelegramText({
        botToken: input.botToken,
        chatId: activation.externalThreadId,
        text: '这个连接链接无效或已过期，请回到 EduCanvas 重新发起连接。',
      });
      return;
    }
    await sendTelegramText({
      botToken: input.botToken,
      chatId: activation.externalThreadId,
      text: 'EduCanvas 已连接。之后在这里发送的私聊会进入你选择的笔记本。',
    });
    return;
  }
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
  if (!binding) return;
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
  chunks = [
    ...chunks,
    ...(await telegramCanvasSummaries(
      events,
      { userId: binding.userId, notebookId: binding.notebookId },
      loadTelegramArtifactResource,
    )),
  ];
  const operationProjection = projectTelegramOperation(events);
  if (operationProjection) {
    chunks =
      operationProjection.status === 'approval_required'
        ? [operationProjection.text]
        : [...chunks, operationProjection.text];
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

/**
 * 长轮询主循环（telegram getUpdates）：
 * - 使用 offset 做幂等性递增，避免重复处理
 * - 失败响应直接抛错退出，依赖外部进程管理重启策略
 * - 处理成功后写入 update_id + 1 作为下一轮起点
 */
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

/**
 * 入口命令：
 * - run: 启动 Telegram 通道消费循环
 * - bind: 写入私有 binding（用户/会话绑定）
 * - validate-fixture: 本地读取 fixture 文件验证 normalize 输出（调试/测试工具）
 */
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
