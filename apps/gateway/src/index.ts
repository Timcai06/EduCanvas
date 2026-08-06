/**
 * EduCanvas Gateway 进程入口 — 独立 HTTP 服务（端口 3200）。
 *
 * ## 职责
 *
 * Gateway 是 Web/TUI/Telegram/Node 等多入口的统一接入层：
 * - 身份认证（session cookie / bearer / channel binding / node pairing）
 * - 路由解析（Principal → Notebook/Conversation）
 * - Operation 编排（幂等、取消、事件持久化）
 * - Turn Runner 适配（调用 Web 教学 Turn Application 或通用 Agent Turn）
 *
 * ## 依赖装配
 *
 * 启动时一次性构造所有 Drizzle Repository 实现，注入到 GatewayService。
 * 与 Web 进程共享同一个 PostgreSQL 数据库。
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseEnv } from 'node:util';
import {
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayConnectionRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayHandoffRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
  requireNotebookAccess,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';
import { resolveSherpaStreamingTranscriptionGateway } from '@educanvas/model-gateway';
import {
  createDefaultGatewayConnectionProviders,
  GatewayConnectionService,
  GatewayService,
  Sha256GatewayRequestFingerprint,
} from '@educanvas/gateway-runtime';
import { readGatewayConfig, normalizeWsAllowedOrigin } from './config';
import { createGatewayEffectReconciliationControl } from './effect-reconciliation-control';
import { createGatewayHttpHandler } from './server';
import { GatewayAgentTurnRunner } from './agent-runner';
import {
  GatewayClientSessionAuth,
  GatewayNodeSessionAuth,
} from './client-auth';
import { GatewayObservability } from './observability';
import { GatewayCanvasResourceService } from './canvas-resource-service';
import { getGatewayTelemetryRuntime } from './telemetry';
import { createStreamingTranscriptionUpgradeHandler } from './streaming-transcription-ws-transport';
import { StreamingTranscriptionTicketStore } from './streaming-transcription-ticket';
import { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import { readStreamingTranscriptionQuotas } from './streaming-transcription-quotas';

function loadWorkspaceEnvFiles(): void {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) break;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
  for (const name of ['.env', '.env.local']) {
    const file = path.join(current, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] ??= value;
    }
  }
}

loadWorkspaceEnvFiles();
const config = readGatewayConfig();
const operationStore = new DrizzleGatewayOperationStore();
const identities = new DrizzleGatewayIdentityRepository();
const directory = new DrizzleGatewayDirectoryRepository();
const connections = new GatewayConnectionService(
  new DrizzleGatewayConnectionRepository(),
  createDefaultGatewayConnectionProviders({
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
  }),
);
const clientSessionSecret =
  config.sessionSecret ??
  (config.localOnboardingEnabled ? randomBytes(32).toString('hex') : null);
const clientSessionAuth = clientSessionSecret
  ? new GatewayClientSessionAuth(clientSessionSecret)
  : null;
// V12：实时语音握手 ticket store（60 秒单次使用，见
// streaming-transcription-ticket.ts）。client transport 未启用时为 null。
const streamingTickets = clientSessionAuth
  ? new StreamingTranscriptionTicketStore()
  : null;
// V12：Notebook 访问校验（ticket 端点与 WS 握手共用同一服务端判定）。
const checkStreamingNotebookAccess = async (input: {
  notebookId: string;
  trustedSubjectId: string;
}): Promise<boolean> => {
  try {
    await requireNotebookAccess(getDb(), {
      notebookId: input.notebookId,
      trustedSubjectId: input.trustedSubjectId,
      requiredPermission: 'notebook.read',
    });
    return true;
  } catch {
    return false;
  }
};
const observability = new GatewayObservability((record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
});
const telemetry = getGatewayTelemetryRuntime();
const service = new GatewayService(
  new DrizzleGatewayRouteResolver(),
  operationStore,
  new GatewayAgentTurnRunner(),
  new Sha256GatewayRequestFingerprint(),
);
// V12：sherpa WASM 流式转录闸门只解析一次（fail-closed，未配置时返回
// { gateway: null, reason } 且不创建 recognizer）。解析结果注入 upgrade
// 处理器；reason 仅用于稳定审计日志。
const streamingTranscription = await resolveSherpaStreamingTranscriptionGateway(
  process.env,
);
// V13：流式转录资源配额（单一配额源，fail-closed：非法配置直接启动失败）
// 与进程内连接槽协调器。协调器只在握手成功后、创建 recognizer 前申请
// 槽位；ticket 签发不占槽。
const streamingQuotas = readStreamingTranscriptionQuotas(process.env);
const streamingQuotaManager = new StreamingTranscriptionQuotaManager(
  streamingQuotas,
);
const server = createServer(
  createGatewayHttpHandler({
    service,
    internalToken: config.internalToken,
    effectReconciliation: config.internalToken
      ? createGatewayEffectReconciliationControl()
      : null,
    clientTransport: clientSessionAuth
      ? {
          bootstrapToken: config.bootstrapToken,
          sessionAuth: clientSessionAuth,
          identities,
          directory,
          localOnboarding: config.localOnboardingEnabled
            ? {
                userId: config.localUserId,
                ensureWorkspace: (userId) =>
                  directory.ensurePersonalWorkspace({ userId }),
              }
            : null,
          approvals: new DrizzleGatewayApprovalRepository(),
          operations: operationStore,
          handoffs: new DrizzleGatewayHandoffRepository(),
          connections,
          canvasResources: new GatewayCanvasResourceService(),
          streamingTickets,
          checkNotebookAccess: checkStreamingNotebookAccess,
        }
      : null,
    nodeTransport:
      config.bootstrapToken && config.sessionSecret
        ? {
            bootstrapToken: config.bootstrapToken,
            sessionAuth: new GatewayNodeSessionAuth(config.sessionSecret),
            nodes: new DrizzleGatewayNodeRepository(),
          }
        : null,
    observability,
    telemetry,
  }),
);

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: 'gateway.started',
      host: config.host,
      port: config.port,
      internalTransportEnabled: config.internalToken !== null,
      clientTransportEnabled: clientSessionAuth !== null,
      localOnboardingEnabled: config.localOnboardingEnabled,
      streamingTranscriptionEnabled:
        streamingTranscription.gateway !== null && clientSessionAuth !== null,
      streamingTranscriptionReason: streamingTranscription.reason,
      streamingTranscriptionOrigins: config.wsAllowedOrigins,
      telemetry: telemetry.health(),
    })}\n`,
  );
});

// V12：双向流式转录通道挂在现有 HTTP server 的 upgrade 事件上，不另起
// 端口/服务。**无条件注册**：client transport 未启用（tickets === null）时
// 握手返回稳定 503 CLIENT_TRANSPORT_DISABLED，而不是被 node 静默断开。
server.on(
  'upgrade',
  createStreamingTranscriptionUpgradeHandler({
    tickets: streamingTickets,
    checkNotebookAccess: checkStreamingNotebookAccess,
    // 严格 Origin 白名单（EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS）：无 Origin
    // （非浏览器客户端，如 node ws / TUI）允许；浏览器 Origin 经同一规范化
    // 后必须命中白名单——带路径/凭据/非法 URL 的 Origin 一律拒绝。
    isAllowedOrigin: (origin) => {
      if (origin === undefined || origin === null) return true;
      const normalized = normalizeWsAllowedOrigin(origin);
      return (
        normalized !== null && config.wsAllowedOrigins.includes(normalized)
      );
    },
    gateway: streamingTranscription.gateway,
    unavailableReason: streamingTranscription.reason,
    quotaManager: streamingQuotaManager,
    quotas: streamingQuotas,
    log: (entry) => {
      process.stdout.write(
        `${JSON.stringify({ event: 'streaming.transcription', ...entry })}\n`,
      );
    },
  }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void telemetry.shutdown().finally(() => process.exit(0));
    });
  });
}
