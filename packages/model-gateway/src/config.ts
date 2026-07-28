/**
 * 模型网关配置 — OpenAI 兼容协议适配器的环境变量解析。
 *
 * ## 配置模型
 *
 * `parseModelGatewayConfiguration()` 从显式传入的环境变量 Record 解析配置，
 * 不主动读 process.env。组合根控制哪些变量进入解析，避免配置泄漏到测试。
 *
 * ## 启用/禁用
 *
 * 配置有两种状态：
 * - **disabled**: MODEL_GATEWAY_PROVIDER 未设置 → `{ enabled: false, reason: 'not_configured' }`
 *   DeepSeek 未被允许 → `{ enabled: false, reason: 'deepseek_not_enabled' }`
 * - **enabled**: 所有必需配置完整 → 可创建 TurnModelGateway
 *
 * 禁用时不抛异常，调用方收到 null Gateway 后自行决定降级策略。
 *
 * ## Provider 约束
 *
 * - deepseek: 仅本地/开发环境可用，staging/production 禁止
 * - openai-compatible: 全环境可用
 * - speech / transcription / image / embedding 仅 openai-compatible provider 支持（DeepSeek 无这些能力）
 *
 * ## 文件职责
 *
 * 本文件只负责核心 Provider 路由：环境、Provider、Runtime、Base URL、Key 与文本
 * 模型别名。媒体能力（语音、转录、图像）的别名与配额解析在 `config-media.ts`；
 * 两者共享的错误码与解析原语在 `config-primitives.ts`。
 *
 * ## 安全
 *
 * 配置异常只暴露稳定错误码（如 MISSING_API_KEY），不把 secret 或原始环境变量拼入消息。
 */

import type { ModelAlias } from '@educanvas/agent-core';
import {
  parseMediaCapabilityLimits,
  parseMediaModelAliases,
  type MediaCapabilityLimits,
} from './config-media';
import {
  deploymentEnvironments,
  isOneOf,
  ModelGatewayConfigurationError,
  openAICompatibleProviders,
  parseBoolean,
  parseBoundedInteger,
  parseModelId,
  parseProviderApiKey,
  parseProviderBaseUrl,
  trimmed,
  turnModelGatewayRuntimes,
  type DeploymentEnvironment,
  type ModelGatewayEnvironment,
  type OpenAICompatibleProvider,
  type TurnModelGatewayRuntime,
} from './config-primitives';
import {
  parseVisionProviderConfiguration,
  type VisionProviderConfiguration,
} from './config-vision';

export {
  deploymentEnvironments,
  ModelGatewayConfigurationError,
  modelGatewayConfigurationErrorCodes,
  openAICompatibleProviders,
  turnModelGatewayRuntimes,
  type DeploymentEnvironment,
  type ModelGatewayConfigurationErrorCode,
  type ModelGatewayEnvironment,
  type OpenAICompatibleProvider,
  type TurnModelGatewayRuntime,
} from './config-primitives';

export interface DisabledModelGatewayConfiguration {
  enabled: false;
  environment: DeploymentEnvironment;
  reason: 'not_configured' | 'deepseek_not_enabled';
}

export interface EnabledModelGatewayConfiguration extends MediaCapabilityLimits {
  enabled: true;
  environment: DeploymentEnvironment;
  provider: OpenAICompatibleProvider;
  runtime: TurnModelGatewayRuntime;
  baseUrl: string;
  apiKey: string;
  modelIds: Readonly<Partial<Record<ModelAlias, string>>> & {
    primary: string;
  };
  timeoutMs: number;
  maxOutputTokens: number;
  /**
   * 当前 primary 模型能否直接读取图片像素。默认 false：多数
   * OpenAI-compatible 文本模型收到图片片段会整轮报错，宁可让物化层明确拒绝
   * 并给出可读提示，也不要把一轮对话赌在供应商的容错上。
   * 由部署方按实际所选模型开启（`MODEL_GATEWAY_VISION=true`）。
   */
  visionEnabled: boolean;
  /**
   * 独立的视觉 Provider；未配置时为 null。主 Provider 只有文本能力时用它承接
   * 图片输入，与 `visionEnabled` 互斥（ADR-0017）。
   */
  visionProvider: VisionProviderConfiguration | null;
}

/**
 * 本次部署能否接受图片输入——无论来自主 Provider 自身还是独立视觉 Provider。
 *
 * 物化层只关心「图片进不进得来」，不关心它最终走哪条链路，因此把两个配置来源
 * 收敛成这一个判据，避免调用方各自拼 `||` 而漏掉其中一种。
 */
export function acceptsImageInput(
  configuration: ModelGatewayConfiguration,
): boolean {
  return (
    configuration.enabled &&
    (configuration.visionEnabled || configuration.visionProvider !== null)
  );
}

export type ModelGatewayConfiguration =
  DisabledModelGatewayConfiguration | EnabledModelGatewayConfiguration;

const parseBaseUrl = (
  value: string | undefined,
  environment: DeploymentEnvironment,
  provider: OpenAICompatibleProvider,
): string => {
  const url = parseProviderBaseUrl(value, environment, {
    missing: 'MISSING_BASE_URL',
    invalid: 'INVALID_BASE_URL',
  });
  /* DeepSeek 锁定官方 hostname：开发期误配成第三方中转会把 Key 送到非授权端点。 */
  if (
    provider === 'deepseek' &&
    (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com')
  ) {
    throw new ModelGatewayConfigurationError('INVALID_BASE_URL');
  }
  return url.toString().replace(/\/$/, '');
};

const parseApiKey = (value: string | undefined): string =>
  parseProviderApiKey(value, {
    missing: 'MISSING_API_KEY',
    invalid: 'INVALID_API_KEY',
  });

/**
 * 从显式传入的环境记录解析配置；函数不会主动读取 process.env，便于组合根控制。
 */
export function parseModelGatewayConfiguration(
  environmentValues: ModelGatewayEnvironment,
): ModelGatewayConfiguration {
  const explicitEnvironment = trimmed(
    environmentValues.EDUCANVAS_DEPLOYMENT_ENV,
  );
  const environmentValue = explicitEnvironment ?? 'local';
  if (!isOneOf(environmentValue, deploymentEnvironments)) {
    throw new ModelGatewayConfigurationError('INVALID_ENVIRONMENT');
  }
  const environment = environmentValue;

  const providerValue = trimmed(environmentValues.MODEL_GATEWAY_PROVIDER);
  if (providerValue === undefined) {
    return { enabled: false, environment, reason: 'not_configured' };
  }
  if (!isOneOf(providerValue, openAICompatibleProviders)) {
    throw new ModelGatewayConfigurationError('INVALID_PROVIDER');
  }
  // 一旦启用真实供应商，部署环境必须显式声明，避免生产误落入 local 策略。
  if (explicitEnvironment === undefined) {
    throw new ModelGatewayConfigurationError('INVALID_ENVIRONMENT');
  }
  const provider = providerValue;
  const runtimeValue =
    trimmed(environmentValues.MODEL_GATEWAY_RUNTIME) ?? 'native';
  if (!isOneOf(runtimeValue, turnModelGatewayRuntimes)) {
    throw new ModelGatewayConfigurationError('INVALID_RUNTIME');
  }

  if (
    provider === 'deepseek' &&
    (environment === 'staging' || environment === 'production')
  ) {
    throw new ModelGatewayConfigurationError('DEEPSEEK_FORBIDDEN');
  }
  if (
    provider === 'deepseek' &&
    !parseBoolean(environmentValues.MODEL_GATEWAY_ALLOW_DEEPSEEK)
  ) {
    return {
      enabled: false,
      environment,
      reason: 'deepseek_not_enabled',
    };
  }

  const apiKey = parseApiKey(environmentValues.MODEL_GATEWAY_API_KEY);
  const primary = parseModelId(
    environmentValues.MODEL_GATEWAY_PRIMARY_MODEL,
    true,
  );
  if (primary === undefined) {
    throw new ModelGatewayConfigurationError('MISSING_PRIMARY_MODEL');
  }
  const fast = parseModelId(environmentValues.MODEL_GATEWAY_FAST_MODEL, false);
  const structured = parseModelId(
    environmentValues.MODEL_GATEWAY_STRUCTURED_MODEL,
    false,
  );
  const mediaAliases = parseMediaModelAliases(environmentValues, provider);
  const visionEnabled = parseBoolean(environmentValues.MODEL_GATEWAY_VISION);
  const modelIds: EnabledModelGatewayConfiguration['modelIds'] = {
    primary,
    ...(fast === undefined ? {} : { fast }),
    ...(structured === undefined ? {} : { structured }),
    ...mediaAliases,
  };

  return {
    enabled: true,
    environment,
    provider,
    runtime: runtimeValue,
    baseUrl: parseBaseUrl(
      environmentValues.MODEL_GATEWAY_BASE_URL,
      environment,
      provider,
    ),
    apiKey,
    modelIds,
    timeoutMs: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_TIMEOUT_MS,
      30_000,
      { min: 1_000, max: 120_000 },
      'INVALID_TIMEOUT',
    ),
    maxOutputTokens: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
      2_048,
      { min: 1, max: 65_536 },
      'INVALID_MAX_OUTPUT_TOKENS',
    ),
    visionEnabled,
    visionProvider: parseVisionProviderConfiguration(
      environmentValues,
      environment,
      visionEnabled,
    ),
    ...parseMediaCapabilityLimits(environmentValues, mediaAliases),
  };
}
