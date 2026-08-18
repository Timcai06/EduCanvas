/**
 * Gateway Turn 公共组合层（R 线 R06）。
 *
 * Gateway 入口的唯一 Drizzle 账本、Trace、ToolKernel 与 ModelGateway 装配点。
 * 入口 `agent-runner.ts` 只提供 identity、profile、transport、capability 差异；
 * 公共依赖构造不得复制到其他 Gateway 文件。
 *
 * Web 入口使用 apps/web/server/turn-composition.ts，与本模块共享同一
 * `ToolKernelPort` 契约与 `createTurnApplication` 工厂。
 */
import type {
  AgentModelRunLedgerPort,
  AgentToolCallLedgerPort,
  AgentTurnContextLedgerPort,
  AssetKind,
  ModelAbortSignal,
  ToolEffectLedgerPort,
  TurnModelGateway,
  TurnUsageBudgetLedgerPort,
} from '@educanvas/agent-core';
import {
  ToolKernel,
  createTurnApplication,
  type ToolKernelPort,
  type TurnApplicationPort,
} from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleAgentTurnContextRepository,
  DrizzleGatewayNodeRepository,
  DrizzleMcpIntentRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolApprovalIntentRepository,
  DrizzleToolEffectRepository,
  DrizzleTurnUsageBudgetLedger,
} from '@educanvas/db';
import type { GatewayResolvedRoute } from '@educanvas/gateway-core';
import {
  acceptsImageInput,
  createTurnModelGateway,
  createVisionTurnModelGateway,
  parseModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from '@educanvas/model-gateway';
import {
  createMcpRuntimeFromEnvironment,
  type McpRuntime,
} from '@educanvas/mcp-runtime';
import {
  createNodeToolAdapters,
  type NodeInvocationPersistencePort,
} from '@educanvas/node-runtime';
import {
  wrapTurnApplicationStream,
  wrapTurnModelGatewayForMetrics,
} from '@educanvas/telemetry';
import { getGatewayTelemetryRuntime } from './telemetry';
import { GatewayGeneralProfile } from './turn-application/general-profile';
import {
  DrizzleGatewayAssetMaterializer,
  type GatewayAssetMaterializer,
} from './asset-context/asset-materialization';
import {
  GatewayBoundCancellation,
  GatewayTurnLifecycle,
  type GatewayTurnRepositoryPort,
} from './turn-application/lifecycle';

/** 模型网关不可用时的诚实失败桩，不伪造空能力成功。 */
export const unavailableModelGateway: TurnModelGateway = {
  async *streamTurnText(request) {
    yield {
      type: 'failed',
      phase: request.phase,
      error: { code: 'unavailable', retryable: true },
    };
  },
};

function readModelEnvironment(): ModelGatewayEnvironment {
  return {
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
    MODEL_GATEWAY_RUNTIME: process.env.MODEL_GATEWAY_RUNTIME,
    MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
    MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
    MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
    MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
    MODEL_GATEWAY_FAST_MODEL: process.env.MODEL_GATEWAY_FAST_MODEL,
    MODEL_GATEWAY_STRUCTURED_MODEL: process.env.MODEL_GATEWAY_STRUCTURED_MODEL,
    MODEL_GATEWAY_TIMEOUT_MS: process.env.MODEL_GATEWAY_TIMEOUT_MS,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
    MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS,
  };
}

/**
 * Gateway 公共依赖全集（R 线 R06）。
 *
 * Gateway 入口及其测试只能通过本函数获取 Drizzle 账本、MCP Runtime 与
 * ModelGateway；`agent-runner.ts` 不得各自 `new DrizzleAgent*Repository()`、
 * `new ToolKernel(...)` 或 `getGatewayTelemetryRuntime().turnTrace`。
 */
export interface GatewayDependencies {
  turns: GatewayTurnRepositoryPort;
  contextLedger: AgentTurnContextLedgerPort;
  modelRunLedger: AgentModelRunLedgerPort;
  usageBudgetLedger: TurnUsageBudgetLedgerPort;
  toolCallLedger: AgentToolCallLedgerPort;
  toolEffectLedger: ToolEffectLedgerPort;
  nodeInvocations: NodeInvocationPersistencePort;
  mcpRuntime: McpRuntime;
  modelGateway: TurnModelGateway;
  /**
   * asset_ref 物化器（DP10）。缺省为 null 时 agent-runner 保留对 asset_ref
   * 的拒绝语义（CAPABILITY_UNAVAILABLE），桌面能力清单升级前不静默放行。
   */
  assetMaterializer?: GatewayAssetMaterializer | null;
  /** 当前 Provider 能原生消费的输入模态；物化层据此决定原生图预算或明确失败。 */
  nativeAssetKinds?: readonly AssetKind[];
}

/**
 * 主 Provider 不读图但配置了视觉 Provider 时，按本轮是否真的含原生图片做
 * 逐轮路由：图片轮走视觉 Provider，纯文本轮继续走主模型（ADR-0017 明确
 * 不能用视觉模型无条件替换主 Gateway）。主 Provider 自带读图能力时恒用主。
 */
function routeNativeImageTurns(
  main: TurnModelGateway,
  vision: TurnModelGateway | null,
  acceptsImages: boolean,
): TurnModelGateway {
  if (acceptsImages || vision === null) return main;
  return {
    async *streamTurnText(request) {
      const hasNativeImages = request.messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'image'),
      );
      const gateway = hasNativeImages ? vision : main;
      yield* gateway.streamTurnText(request);
    },
  };
}

export function createGatewayDependencies(): GatewayDependencies {
  const environment = readModelEnvironment();
  const configuration = parseModelGatewayConfiguration(environment);
  const baseGateway = configuration.enabled
    ? createTurnModelGateway(configuration)
    : null;
  const visionGateway = configuration.enabled
    ? createVisionTurnModelGateway(configuration)
    : null;
  const acceptsImages =
    configuration.enabled && acceptsImageInput(configuration);
  /* 主模型读图或配了独立视觉 Provider，二者任一成立都允许原生图输入。 */
  const nativeAssetKinds: readonly AssetKind[] =
    acceptsImages || visionGateway !== null ? ['image'] : [];
  return {
    turns: new DrizzlePlatformTurnRepository(),
    contextLedger: new DrizzleAgentTurnContextRepository(),
    modelRunLedger: new DrizzleAgentModelRunRepository(),
    usageBudgetLedger: new DrizzleTurnUsageBudgetLedger(),
    toolCallLedger: new DrizzleAgentToolCallRepository(),
    toolEffectLedger: new DrizzleToolEffectRepository(),
    nodeInvocations: new DrizzleGatewayNodeRepository(),
    mcpRuntime: createMcpRuntimeFromEnvironment(undefined, {
      durableIntents: new DrizzleMcpIntentRepository(),
      approvalIntents: new DrizzleToolApprovalIntentRepository(),
    }),
    modelGateway: routeNativeImageTurns(
      baseGateway ?? unavailableModelGateway,
      visionGateway,
      acceptsImages,
    ),
    assetMaterializer: new DrizzleGatewayAssetMaterializer(),
    nativeAssetKinds,
  };
}

/**
 * 从 Gateway 依赖与路由创建 TurnApplication。
 * Gateway 入口只提供 route 与 signal 差异，不复制公共装配。
 */
export function createGatewayTurnApplication(
  deps: GatewayDependencies,
  input: { signal: ModelAbortSignal; route: GatewayResolvedRoute },
): TurnApplicationPort {
  const telemetry = getGatewayTelemetryRuntime();
  const nodeAdapters = createNodeToolAdapters(deps.nodeInvocations);
  const toolAdapters = [...deps.mcpRuntime.adapters, ...nodeAdapters];
  const application = createTurnApplication({
    lifecycle: new GatewayTurnLifecycle(deps.turns),
    profile: new GatewayGeneralProfile(
      deps.turns,
      deps.nodeInvocations,
      deps.mcpRuntime.capabilities,
      input.route.membershipRole,
      deps.assetMaterializer ?? null,
      deps.nativeAssetKinds ?? [],
    ),
    contextLedger: deps.contextLedger,
    modelRunLedger: deps.modelRunLedger,
    usageBudgetLedger: deps.usageBudgetLedger,
    modelGateway: wrapTurnModelGatewayForMetrics(
      deps.modelGateway,
      telemetry.metrics,
    ),
    toolKernel: new ToolKernel(
      toolAdapters,
      deps.toolCallLedger,
      deps.toolEffectLedger,
    ),
    cancellation: new GatewayBoundCancellation(input.signal, deps.turns),
    trace: getGatewayTelemetryRuntime().turnTrace,
  });
  return {
    run(command) {
      return wrapTurnApplicationStream(
        application.run(command),
        telemetry.metrics,
      );
    },
  };
}
