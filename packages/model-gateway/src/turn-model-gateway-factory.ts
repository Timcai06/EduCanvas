import type { TurnModelGateway } from '@educanvas/agent-core';
import { createAiSdkTurnModelGateway } from './ai-sdk/ai-sdk-provider-factory';
import {
  parseModelGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from './config/config';
import { ModelGatewayConfigurationError } from './config/config-primitives';
import {
  OpenAICompatibleTurnModelGateway,
  type OpenAICompatibleTurnModelGatewayOptions,
} from './openai-compatible-turn-model-gateway';

/**
 * 模型网关工厂 — 已验证配置到 TurnModelGateway 的构造路径。
 *
 * ## 两种入口（R03 单次解析纪律）
 *
 * - **`createTurnModelGateway(config)`**：接收已验证配置对象，内部不读取
 *   `process.env`、不再次解析环境。组合根先 `parseModelGatewayConfiguration`
 *   一次，再把配置对象注入本工厂与各能力解析器，保证同一组合根只解析一次。
 * - **`createTurnModelGatewayFromEnvironment(env)`**：组合根便捷入口，内部
 *   parse 恰好一次后委托 `createTurnModelGateway`。只适合进程级一次性装配
 *   （如 Gateway 启动期）；需要同一配置服务多个能力时请先 parse 一次再注入。
 *
 * ## 两种运行时
 *
 * - **native**: 本包自带的 OpenAICompatibleTurnModelGateway — 纯 fetch + SSE 解析
 * - **ai-sdk**: 通过 Vercel AI SDK 适配 — 提供 provider 抽象层的兼容性
 *
 * 运行时由已验证配置的 `runtime` 字段决定，构造本身无网络副作用。
 */

/** 从已验证配置构造 Turn Provider；配置必须已通过 `parseModelGatewayConfiguration`。 */
export function createTurnModelGateway(
  config: EnabledModelGatewayConfiguration,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway {
  return config.runtime === 'ai-sdk'
    ? createAiSdkTurnModelGateway(config, options)
    : new OpenAICompatibleTurnModelGateway(config, options);
}

/** 解析显式环境并构造Turn Provider；disabled配置返回null且不触发网络。 */
export function createTurnModelGatewayFromEnvironment(
  environment: ModelGatewayEnvironment,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway | null {
  const config = parseModelGatewayConfiguration(environment);
  if (!config.enabled) return null;
  return createTurnModelGateway(config, options);
}

/**
 * 把视觉 Provider 投影成一份完整的 Turn 配置。
 *
 * 视觉 Provider 只服务图片输入这一条链路，没有 primary/fast/structured 的档位
 * 区分，因此所有 alias 都指向同一个视觉模型——否则 `synthesis` 阶段按 `fast`
 * 取模型会取到 undefined，整轮静默失败。
 *
 * `provider` 固定为 `openai-compatible`：视觉 Provider 不是 DeepSeek，不能继承主
 * 配置里 DeepSeek 专属的请求形态（如固定关闭 thinking）。
 */
function projectVisionConfiguration(
  config: EnabledModelGatewayConfiguration,
): EnabledModelGatewayConfiguration {
  const vision = config.visionProvider;
  if (vision === null) {
    throw new ModelGatewayConfigurationError('MISSING_VISION_BASE_URL');
  }
  return {
    ...config,
    provider: 'openai-compatible',
    baseUrl: vision.baseUrl,
    apiKey: vision.apiKey,
    modelIds: {
      primary: vision.modelId,
      fast: vision.modelId,
      structured: vision.modelId,
    },
    timeoutMs: vision.timeoutMs,
    maxOutputTokens: vision.maxOutputTokens,
    /*
     * 思考开关取视觉 Provider 自己的声明，不继承主 Provider：两者是不同供应商，
     * 主链路关不关思考与视觉模型是否默认开启思考无关。
     */
    disableThinking: vision.disableThinking,
    /* 投影后的配置自身就是视觉链路，置真避免下游再次尝试路由。 */
    visionEnabled: true,
    visionProvider: null,
  };
}

/**
 * 从已验证配置构造承接图片输入的 Turn Provider；未配置独立视觉 Provider 时
 * 返回 null。
 *
 * 与主 Gateway 分开构造而不是在一个 Gateway 内部按模态分支：Adapter 持有 Base URL
 * 与 Key，把两套凭据塞进同一个实例会让「这次请求用了哪个供应商」在审计里变得
 * 不可判定（ADR-0017）。
 *
 * 视觉链路固定走 native Adapter：AI SDK Adapter 的 provider 抽象目前只按主配置
 * 的 runtime 解析，尚未覆盖多 Provider 图片投影。
 *
 * 本入口不读取 `process.env`，也不再次解析环境（R03）：视觉配置已在
 * `parseModelGatewayConfiguration` 的 `visionProvider` 字段中验证完毕。
 */
export function createVisionTurnModelGateway(
  config: EnabledModelGatewayConfiguration,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway | null {
  if (config.visionProvider === null) return null;
  return new OpenAICompatibleTurnModelGateway(
    projectVisionConfiguration(config),
    options,
  );
}

/** 便捷入口：解析一次环境后委托 `createVisionTurnModelGateway`；与主 Factory 同纪律。 */
export function createVisionTurnModelGatewayFromEnvironment(
  environment: ModelGatewayEnvironment,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway | null {
  const config = parseModelGatewayConfiguration(environment);
  if (!config.enabled) return null;
  return createVisionTurnModelGateway(config, options);
}
