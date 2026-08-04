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
    const modelId = parseModelId(rawValue, false);
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

/** 解析媒体能力配额。上下界是防御异常部署配置的硬边界，不是性能调优旋钮。 */
export function parseMediaCapabilityLimits(
  environmentValues: ModelGatewayEnvironment,
  aliases: MediaModelAliases,
): MediaCapabilityLimits {
  return {
    embeddingModelVersion: parseEmbeddingModelVersion(
      environmentValues.MODEL_GATEWAY_EMBEDDING_MODEL_VERSION,
      aliases.embedding !== undefined,
    ),
    embeddingTimeoutMs: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS,
      60_000,
      { min: 1_000, max: 180_000 },
      'INVALID_EMBEDDING_TIMEOUT',
    ),
    /* 批量上限同时约束单次供应商请求体和 Worker 单批持锁时间。 */
    embeddingMaxBatch: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_EMBEDDING_MAX_BATCH,
      64,
      { min: 1, max: 256 },
      'INVALID_EMBEDDING_MAX_BATCH',
    ),
    speechVoice: parseSpeechVoice(environmentValues.MODEL_GATEWAY_SPEECH_VOICE),
    speechTimeoutMs: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_SPEECH_TIMEOUT_MS,
      60_000,
      { min: 1_000, max: 180_000 },
      'INVALID_SPEECH_TIMEOUT',
    ),
    speechMaxInputChars: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS,
      3_500,
      { min: 80, max: 4_096 },
      'INVALID_SPEECH_MAX_INPUT_CHARS',
    ),
    transcriptionTimeoutMs: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS,
      120_000,
      { min: 5_000, max: 300_000 },
      'INVALID_TRANSCRIPTION_TIMEOUT',
    ),
    transcriptionMaxInputBytes: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES,
      25 * 1024 * 1024,
      { min: 1024, max: 50 * 1024 * 1024 },
      'INVALID_TRANSCRIPTION_MAX_INPUT_BYTES',
    ),
    imageTimeoutMs: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_IMAGE_TIMEOUT_MS,
      120_000,
      { min: 5_000, max: 300_000 },
      'INVALID_IMAGE_TIMEOUT',
    ),
    imageMaxOutputBytes: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES,
      8 * 1024 * 1024,
      { min: 1024, max: 20 * 1024 * 1024 },
      'INVALID_IMAGE_MAX_OUTPUT_BYTES',
    ),
  };
}
