import type { TurnModelGateway } from '@educanvas/agent-core';
import { createAiSdkTurnModelGateway } from './ai-sdk-provider-factory';
import {
  parseModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from './config';
import {
  OpenAICompatibleTurnModelGateway,
  type OpenAICompatibleTurnModelGatewayOptions,
} from './openai-compatible-turn-model-gateway';

/**
 * 模型网关工厂 — 环境配置到 TurnModelGateway 的唯一构造路径。
 *
 * ## 两种运行时
 *
 * - **native**: 本包自带的 OpenAICompatibleTurnModelGateway — 纯 fetch + SSE 解析
 * - **ai-sdk**: 通过 Vercel AI SDK 适配 — 提供 provider 抽象层的兼容性
 *
 * 运行时由 `MODEL_GATEWAY_RUNTIME` 环境变量控制，默认 native。
 *
 * ## 返回值
 *
 * - null: 配置禁用（未配置 provider 或 DeepSeek 不允许） → 调用方自行降级
 * - TurnModelGateway: 配置完整 → 正常使用
 *
 * ## 设计意图
 *
 * 工厂函数组合 `parseModelGatewayConfiguration`（纯解析）和 Gateway 构造（副作用）。
 * 分离的好处：配置解析可独立测试（无网络），Gateway 构造只在生产路径调用。
 */

/** 解析显式环境并构造Turn Provider；disabled配置返回null且不触发网络。 */
export function createTurnModelGatewayFromEnvironment(
  environment: ModelGatewayEnvironment,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway | null {
  const config = parseModelGatewayConfiguration(environment);
  if (!config.enabled) return null;
  return config.runtime === 'ai-sdk'
    ? createAiSdkTurnModelGateway(config, options)
    : new OpenAICompatibleTurnModelGateway(config, options);
}
