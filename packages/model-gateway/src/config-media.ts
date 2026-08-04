/**
 * 非文本能力配置 — 语音、转录、图像与向量化的模型别名与配额解析。
 *
 * 这些能力共享同一条纪律，因此单独成文件：
 * - 都只有 `openai-compatible` Provider 支持，DeepSeek 配置任一别名都是错误；
 * - 都以「别名未配置 = 能力不存在」表达关闭，而不是运行时再降级；
 * - 配额（超时、输入/输出上界、批量）都必须是显式有界整数，越界只暴露稳定错误码。
 *
 * embedding 额外要求显式声明模型版本：向量的可比较性完全依赖它，而供应商通常
 * 不在响应里回传版本。
 *
 * 核心 Provider 路由（环境、Provider、Base URL、Key、主模型）留在 `config.ts`，
 * 两边不共享可变状态，只共享纯解析原语。
 */

import {
  ModelGatewayConfigurationError,
  parseBoundedInteger,
  parseModelId,
  trimmed,
  type ModelGatewayConfigurationErrorCode,
  type ModelGatewayEnvironment,
  type OpenAICompatibleProvider,
} from './config-primitives';

/** 媒体与检索能力解析后的模型别名；未配置的能力不会出现在结果里。 */
export interface MediaModelAliases {
  speech?: string;
  transcription?: string;
  image?: string;
  embedding?: string;
}

export type MediaCapability = keyof MediaModelAliases;

/** 媒体能力的运行配额；即使对应别名未配置也会带默认值，便于类型完整。 */
export interface MediaCapabilityLimits {
  speechVoice: string;
  speechTimeoutMs: number;
  speechMaxInputChars: number;
  transcriptionTimeoutMs: number;
  transcriptionMaxInputBytes: number;
  imageTimeoutMs: number;
  /**
   * 单张生成图像可接受的最大字节数。它同时是解码前的 base64 长度上界依据，
   * 让适配器在把供应商响应读进内存前就能拒绝异常体积，而不是解码完再判断。
   */
  imageMaxOutputBytes: number;
  /**
   * 部署方声明的 embedding 模型版本。供应商通常不在响应里回传版本，但向量的
   * 可比较性完全依赖它：同名模型换权重后旧向量必须被视为不同空间。因此配置了
   * embedding 模型就必须同时声明版本，缺失即配置错误。
   */
  embeddingModelVersion: string | null;
  embeddingTimeoutMs: number;
  embeddingMaxBatch: number;
}

const parseSpeechVoice = (value: string | undefined): string => {
  const voice = trimmed(value) ?? 'alloy';
  if (voice.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(voice)) {
    throw new ModelGatewayConfigurationError('INVALID_SPEECH_VOICE');
  }
  return voice;
};

const defaultMediaCapabilityLimits: MediaCapabilityLimits = {
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
  transcriptionTimeoutMs: 120_000,
  transcriptionMaxInputBytes: 25 * 1024 * 1024,
  imageTimeoutMs: 120_000,
  imageMaxOutputBytes: 8 * 1024 * 1024,
  embeddingModelVersion: null,
  embeddingTimeoutMs: 60_000,
  embeddingMaxBatch: 64,
};

/**
 * 解析媒体模型别名。主 Provider 不支持的别名不产生，能力归属交给
 * `config-capability.ts` 的 per-capability 解析（ADR-0021）：DeepSeek 主配置下
 * 声明 speech 别名不再整组抛错，而是该能力关闭，除非显式配置了独立 override。
 * 整组失败会让一个媒体端点的配置错误拖垮文本 Agent，与 ADR-0021 语义相反。
 */
export function parseMediaModelAliases(
  environmentValues: ModelGatewayEnvironment,
  provider: OpenAICompatibleProvider,
): MediaModelAliases {
  const aliases: readonly [keyof MediaModelAliases, string | undefined][] = [
    ['speech', environmentValues.MODEL_GATEWAY_SPEECH_MODEL],
    ['transcription', environmentValues.MODEL_GATEWAY_TRANSCRIPTION_MODEL],
    ['image', environmentValues.MODEL_GATEWAY_IMAGE_MODEL],
    ['embedding', environmentValues.MODEL_GATEWAY_EMBEDDING_MODEL],
  ];

  const result: MediaModelAliases = {};
  for (const [alias, rawValue] of aliases) {
    let modelId: string | undefined;
    try {
      modelId = parseModelId(rawValue, false);
    } catch (error) {
      if (error instanceof ModelGatewayConfigurationError) continue;
      throw error;
    }
    if (modelId === undefined) continue;
    if (provider !== 'openai-compatible') continue;
    result[alias] = modelId;
  }
  return result;
}

/**
 * 解析 embedding 模型版本。只在确实配置了 embedding 模型时要求它存在：
 * 未启用向量检索的部署不应该被一个无关的必填项卡住。
 */
function parseEmbeddingModelVersion(
  value: string | undefined,
  embeddingConfigured: boolean,
): string | null {
  const version = trimmed(value);
  if (version === undefined) {
    if (embeddingConfigured) {
      throw new ModelGatewayConfigurationError(
        'MISSING_EMBEDDING_MODEL_VERSION',
      );
    }
    return null;
  }
  if (version.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(version)) {
    throw new ModelGatewayConfigurationError('INVALID_EMBEDDING_MODEL_VERSION');
  }
  return version;
}

/**
 * 严格解析单一能力的运行配额。能力字段非法时返回 null，让组合根只关闭该能力；
 * 主文本配置不得因为一个媒体上限或 voice 拼错而整体失败（ADR-0021）。
 */
export function parseMediaCapabilityLimitProjection(
  environmentValues: ModelGatewayEnvironment,
  capability: MediaCapability,
  modelConfigured: boolean,
): Partial<MediaCapabilityLimits> | null {
  try {
    switch (capability) {
      case 'speech':
        return {
          speechVoice: parseSpeechVoice(
            environmentValues.MODEL_GATEWAY_SPEECH_VOICE,
          ),
          speechTimeoutMs: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_SPEECH_TIMEOUT_MS,
            defaultMediaCapabilityLimits.speechTimeoutMs,
            { min: 1_000, max: 180_000 },
            'INVALID_SPEECH_TIMEOUT',
          ),
          speechMaxInputChars: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS,
            defaultMediaCapabilityLimits.speechMaxInputChars,
            { min: 80, max: 4_096 },
            'INVALID_SPEECH_MAX_INPUT_CHARS',
          ),
        };
      case 'transcription':
        return {
          transcriptionTimeoutMs: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS,
            defaultMediaCapabilityLimits.transcriptionTimeoutMs,
            { min: 5_000, max: 300_000 },
            'INVALID_TRANSCRIPTION_TIMEOUT',
          ),
          transcriptionMaxInputBytes: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES,
            defaultMediaCapabilityLimits.transcriptionMaxInputBytes,
            { min: 1024, max: 50 * 1024 * 1024 },
            'INVALID_TRANSCRIPTION_MAX_INPUT_BYTES',
          ),
        };
      case 'image':
        return {
          imageTimeoutMs: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_IMAGE_TIMEOUT_MS,
            defaultMediaCapabilityLimits.imageTimeoutMs,
            { min: 5_000, max: 300_000 },
            'INVALID_IMAGE_TIMEOUT',
          ),
          imageMaxOutputBytes: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES,
            defaultMediaCapabilityLimits.imageMaxOutputBytes,
            { min: 1024, max: 20 * 1024 * 1024 },
            'INVALID_IMAGE_MAX_OUTPUT_BYTES',
          ),
        };
      case 'embedding':
        return {
          embeddingModelVersion: parseEmbeddingModelVersion(
            environmentValues.MODEL_GATEWAY_EMBEDDING_MODEL_VERSION,
            modelConfigured,
          ),
          embeddingTimeoutMs: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS,
            defaultMediaCapabilityLimits.embeddingTimeoutMs,
            { min: 1_000, max: 180_000 },
            'INVALID_EMBEDDING_TIMEOUT',
          ),
          embeddingMaxBatch: parseBoundedInteger(
            environmentValues.MODEL_GATEWAY_EMBEDDING_MAX_BATCH,
            defaultMediaCapabilityLimits.embeddingMaxBatch,
            { min: 1, max: 256 },
            'INVALID_EMBEDDING_MAX_BATCH',
          ),
        };
    }
  } catch (error) {
    if (error instanceof ModelGatewayConfigurationError) return null;
    throw error;
  }
}

/**
 * 主配置只承载文本路由与各能力的默认/有效投影。非法媒体字段在这里退回默认值，
 * 随后由 `resolveCapabilityGatewayConfiguration()` 严格解析并关闭对应能力。
 */
export function parseMediaCapabilityLimits(
  environmentValues: ModelGatewayEnvironment,
  aliases: MediaModelAliases,
): MediaCapabilityLimits {
  return {
    ...defaultMediaCapabilityLimits,
    ...(parseMediaCapabilityLimitProjection(
      environmentValues,
      'speech',
      aliases.speech !== undefined,
    ) ?? {}),
    ...(parseMediaCapabilityLimitProjection(
      environmentValues,
      'transcription',
      aliases.transcription !== undefined,
    ) ?? {}),
    ...(parseMediaCapabilityLimitProjection(
      environmentValues,
      'image',
      aliases.image !== undefined,
    ) ?? {}),
    ...(parseMediaCapabilityLimitProjection(
      environmentValues,
      'embedding',
      aliases.embedding !== undefined,
    ) ?? {}),
  };
}
