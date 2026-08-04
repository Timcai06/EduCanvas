/**
 * 媒体能力独立 Provider override 解析 — ADR-0021 的配置语义实现。
 *
 * ## 为什么需要
 *
 * speech/transcription/image/embedding 当前只能继承主 Provider 的 Base URL 与
 * API Key：`config-media.ts` 只解析别名与配额，Provider 和凭据永远来自主配置。
 * ADR-0021 允许每项能力显式声明独立 Provider、模型、端点与凭据，未声明时按
 * 主 Provider 支持矩阵整组继承或关闭。
 *
 * ## 三种终态
 *
 * - `inherited`：未声明能力 Provider，且主 Provider 明确支持该能力 → 整组继承
 *   主 Provider 的 Base URL 与 Key，模型仍用能力自己的别名；
 * - `overridden`：能力 Provider 已声明且配置组完整 → 独立路由，凭据与主隔离；
 * - `disabled`：主 Provider 不支持、能力配置组不完整或非法 → 只关闭该能力，
 *   绝不拖垮文本 Agent。
 *
 * ## 能力级错误只关闭能力
 *
 * 与主配置解析（`config.ts`）的失败语义不同：媒体能力配错不能像 DeepSeek 配了
 * speech alias 那样整组抛错，否则一个媒体端点的笔误会让整条教学主链路失效。
 * 因此本解析器把一切能力级错误收敛为 `disabled`，不抛异常；配置错误的暴露留给
 * env-check 的能力状态输出（C03），运行时只表现为该能力不可用。
 *
 * ## 安全
 *
 * 与主配置同一套校验原语：URL 拒绝内嵌凭据/query/hash，staging/production
 * 强制 https；API Key 只做形状校验。错误路径不携带 secret。
 */

import {
  isOneOf,
  ModelGatewayConfigurationError,
  openAICompatibleProviders,
  parseBoundedInteger,
  parseModelId,
  parseProviderApiKey,
  parseProviderBaseUrl,
  trimmed,
  type DeploymentEnvironment,
  type ModelGatewayEnvironment,
  type OpenAICompatibleProvider,
} from './config-primitives';

/** 可独立配置 Provider 的媒体能力闭集；vision 走 ADR-0017 既有配置。 */
export const overrideCapabilities = [
  'speech',
  'transcription',
  'image',
  'embedding',
] as const;

export type OverrideCapability = (typeof overrideCapabilities)[number];

/** 每种能力允许的 Provider 集合；能力不兼容时关闭而不是错误继承。 */
const capabilitySupportedProviders: Readonly<
  Record<OverrideCapability, readonly OpenAICompatibleProvider[]>
> = {
  /* DeepSeek 只有文本能力：官方能力表没有媒体项（docs/03-ai/03-模型路由.md）。 */
  speech: ['openai-compatible'],
  transcription: ['openai-compatible'],
  image: ['openai-compatible'],
  embedding: ['openai-compatible'],
};

interface CapabilityEnvironmentKeys {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: string;
}

/** 每种能力的 override 变量名；命名冻结见 ADR-0021 §3。 */
const capabilityKeys: Readonly<
  Record<OverrideCapability, CapabilityEnvironmentKeys>
> = {
  speech: {
    provider: 'MODEL_GATEWAY_SPEECH_PROVIDER',
    model: 'MODEL_GATEWAY_SPEECH_MODEL',
    baseUrl: 'MODEL_GATEWAY_SPEECH_BASE_URL',
    apiKey: 'MODEL_GATEWAY_SPEECH_API_KEY',
    timeoutMs: 'MODEL_GATEWAY_SPEECH_TIMEOUT_MS',
  },
  transcription: {
    provider: 'MODEL_GATEWAY_TRANSCRIPTION_PROVIDER',
    model: 'MODEL_GATEWAY_TRANSCRIPTION_MODEL',
    baseUrl: 'MODEL_GATEWAY_TRANSCRIPTION_BASE_URL',
    apiKey: 'MODEL_GATEWAY_TRANSCRIPTION_API_KEY',
    timeoutMs: 'MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS',
  },
  image: {
    provider: 'MODEL_GATEWAY_IMAGE_PROVIDER',
    model: 'MODEL_GATEWAY_IMAGE_MODEL',
    baseUrl: 'MODEL_GATEWAY_IMAGE_BASE_URL',
    apiKey: 'MODEL_GATEWAY_IMAGE_API_KEY',
    timeoutMs: 'MODEL_GATEWAY_IMAGE_TIMEOUT_MS',
  },
  embedding: {
    provider: 'MODEL_GATEWAY_EMBEDDING_PROVIDER',
    model: 'MODEL_GATEWAY_EMBEDDING_MODEL',
    baseUrl: 'MODEL_GATEWAY_EMBEDDING_BASE_URL',
    apiKey: 'MODEL_GATEWAY_EMBEDDING_API_KEY',
    timeoutMs: 'MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS',
  },
};

/** 能力专属超时上限，复用 `config-media.ts` 的既有边界，不伪装成通用 Token 配置。 */
const capabilityTimeoutBounds: Readonly<
  Record<
    OverrideCapability,
    {
      defaultMs: number;
      min: number;
      max: number;
      errorCode:
        | 'INVALID_SPEECH_TIMEOUT'
        | 'INVALID_TRANSCRIPTION_TIMEOUT'
        | 'INVALID_IMAGE_TIMEOUT'
        | 'INVALID_EMBEDDING_TIMEOUT';
    }
  >
> = {
  speech: {
    defaultMs: 60_000,
    min: 1_000,
    max: 180_000,
    errorCode: 'INVALID_SPEECH_TIMEOUT',
  },
  transcription: {
    defaultMs: 120_000,
    min: 5_000,
    max: 300_000,
    errorCode: 'INVALID_TRANSCRIPTION_TIMEOUT',
  },
  image: {
    defaultMs: 120_000,
    min: 5_000,
    max: 300_000,
    errorCode: 'INVALID_IMAGE_TIMEOUT',
  },
  embedding: {
    defaultMs: 60_000,
    min: 1_000,
    max: 180_000,
    errorCode: 'INVALID_EMBEDDING_TIMEOUT',
  },
};

/** 主 Provider 是否明确支持该能力；未配置 override 时只有支持才允许整组继承。 */
export function primaryProviderSupportsCapability(
  provider: OpenAICompatibleProvider,
  capability: OverrideCapability,
): boolean {
  return capabilitySupportedProviders[capability].includes(provider);
}

/**
 * 已解析的独立能力配置。Provider、模型、端点与凭据是一个完整配置组：
 * 不允许出现「Base URL 来自能力声明、Key 来自主配置」的隐式混合。
 */
export interface CapabilityOverrideConfiguration {
  provider: OpenAICompatibleProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export type CapabilityConfiguration =
  | { kind: 'inherited' }
  | { kind: 'overridden'; override: CapabilityOverrideConfiguration }
  | { kind: 'disabled' };

/**
 * 解析单种媒体能力的 Provider 归属。
 *
 * 未配置能力 Provider 时按主 Provider 支持矩阵整组继承或关闭；显式配置后
 * 必须同时给出模型、Base URL 与 Key，缺任一即关闭该能力——半配置会让部署
 * 以为能力可用，直到运行时才失败。
 *
 * 能力级错误一律收敛为 `disabled`，不抛异常（见文件头说明）。
 *
 * @param primaryProvider 主 Provider；决定未声明 override 时的继承资格。
 * @param environment 部署环境，用于 URL 的 staging/production https 强制。
 */
export function parseCapabilityConfiguration(
  environmentValues: ModelGatewayEnvironment,
  capability: OverrideCapability,
  primaryProvider: OpenAICompatibleProvider,
  environment: DeploymentEnvironment,
): CapabilityConfiguration {
  const keys = capabilityKeys[capability];
  const providerValue = trimmed(environmentValues[keys.provider]);

  if (providerValue === undefined) {
    return primaryProviderSupportsCapability(primaryProvider, capability)
      ? { kind: 'inherited' }
      : { kind: 'disabled' };
  }
  if (
    !isOneOf(providerValue, openAICompatibleProviders) ||
    !capabilitySupportedProviders[capability].includes(providerValue)
  ) {
    return { kind: 'disabled' };
  }

  const modelId = parseModelId(environmentValues[keys.model], false);
  if (modelId === undefined) return { kind: 'disabled' };

  /* 配置组完整性：模型与 Base URL、Key 必须同组出现，不允许隐式拼接主凭据。 */
  let baseUrl: URL;
  let apiKey: string;
  try {
    baseUrl = parseProviderBaseUrl(
      environmentValues[keys.baseUrl],
      environment,
      {
        missing: 'INVALID_BASE_URL',
        invalid: 'INVALID_BASE_URL',
      },
    );
    apiKey = parseProviderApiKey(environmentValues[keys.apiKey], {
      missing: 'INVALID_API_KEY',
      invalid: 'INVALID_API_KEY',
    });
  } catch (error) {
    if (error instanceof ModelGatewayConfigurationError) {
      return { kind: 'disabled' };
    }
    throw error;
  }

  const timeoutBounds = capabilityTimeoutBounds[capability];
  let timeoutMs: number;
  try {
    timeoutMs = parseBoundedInteger(
      environmentValues[keys.timeoutMs],
      timeoutBounds.defaultMs,
      { min: timeoutBounds.min, max: timeoutBounds.max },
      timeoutBounds.errorCode,
    );
  } catch (error) {
    if (error instanceof ModelGatewayConfigurationError) {
      return { kind: 'disabled' };
    }
    throw error;
  }

  return {
    kind: 'overridden',
    override: {
      provider: providerValue,
      model: modelId,
      baseUrl: baseUrl.toString().replace(/\/$/, ''),
      apiKey,
      timeoutMs,
    },
  };
}
