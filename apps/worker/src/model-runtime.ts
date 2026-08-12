import type {
  AudioTranscriptionModelGateway,
  EmbeddingModelGateway,
  ImageGenerationModelGateway,
  SpeechModelGateway,
  StructuredModelGateway,
} from '@educanvas/agent-core';
import type { EmbeddingIdentity } from '@educanvas/db';
import {
  EMBEDDING_INSTRUCTION_VERSION,
  OpenAICompatibleAudioTranscriptionModelGateway,
  OpenAICompatibleEmbeddingModelGateway,
  OpenAICompatibleImageGenerationModelGateway,
  OpenAICompatibleSpeechModelGateway,
  OpenAICompatibleStructuredModelGateway,
  parseModelGatewayConfiguration,
  resolveCapabilityGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
  type ModelGatewayEnvironment,
  type OverrideCapability,
} from '@educanvas/model-gateway';

/**
 * worker 是非对话模型任务的唯一调用方(ADR-0005)。与 Web 组合根同一纪律:
 * 显式转交环境变量、未配置返回 null 由调用方诚实降级/失败,Key 不出适配器。
 */
/** 读取并显式转交模型网关环境变量（组合根职责；Factory 自身不读 process.env）。 */
export function readModelGatewayEnvironment(): ModelGatewayEnvironment {
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
    MODEL_GATEWAY_SPEECH_PROVIDER: process.env.MODEL_GATEWAY_SPEECH_PROVIDER,
    MODEL_GATEWAY_SPEECH_MODEL: process.env.MODEL_GATEWAY_SPEECH_MODEL,
    MODEL_GATEWAY_SPEECH_BASE_URL: process.env.MODEL_GATEWAY_SPEECH_BASE_URL,
    MODEL_GATEWAY_SPEECH_API_KEY: process.env.MODEL_GATEWAY_SPEECH_API_KEY,
    MODEL_GATEWAY_SPEECH_VOICE: process.env.MODEL_GATEWAY_SPEECH_VOICE,
    MODEL_GATEWAY_SPEECH_TIMEOUT_MS:
      process.env.MODEL_GATEWAY_SPEECH_TIMEOUT_MS,
    MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS:
      process.env.MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS,
    MODEL_GATEWAY_TRANSCRIPTION_PROVIDER:
      process.env.MODEL_GATEWAY_TRANSCRIPTION_PROVIDER,
    MODEL_GATEWAY_TRANSCRIPTION_MODEL:
      process.env.MODEL_GATEWAY_TRANSCRIPTION_MODEL,
    MODEL_GATEWAY_TRANSCRIPTION_BASE_URL:
      process.env.MODEL_GATEWAY_TRANSCRIPTION_BASE_URL,
    MODEL_GATEWAY_TRANSCRIPTION_API_KEY:
      process.env.MODEL_GATEWAY_TRANSCRIPTION_API_KEY,
    MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS:
      process.env.MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS,
    MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES:
      process.env.MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES,
    MODEL_GATEWAY_EMBEDDING_PROVIDER:
      process.env.MODEL_GATEWAY_EMBEDDING_PROVIDER,
    MODEL_GATEWAY_EMBEDDING_MODEL: process.env.MODEL_GATEWAY_EMBEDDING_MODEL,
    MODEL_GATEWAY_EMBEDDING_BASE_URL:
      process.env.MODEL_GATEWAY_EMBEDDING_BASE_URL,
    MODEL_GATEWAY_EMBEDDING_API_KEY:
      process.env.MODEL_GATEWAY_EMBEDDING_API_KEY,
    MODEL_GATEWAY_EMBEDDING_MODEL_VERSION:
      process.env.MODEL_GATEWAY_EMBEDDING_MODEL_VERSION,
    MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS:
      process.env.MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS,
    MODEL_GATEWAY_EMBEDDING_MAX_BATCH:
      process.env.MODEL_GATEWAY_EMBEDDING_MAX_BATCH,
    MODEL_GATEWAY_IMAGE_PROVIDER: process.env.MODEL_GATEWAY_IMAGE_PROVIDER,
    MODEL_GATEWAY_IMAGE_MODEL: process.env.MODEL_GATEWAY_IMAGE_MODEL,
    MODEL_GATEWAY_IMAGE_BASE_URL: process.env.MODEL_GATEWAY_IMAGE_BASE_URL,
    MODEL_GATEWAY_IMAGE_API_KEY: process.env.MODEL_GATEWAY_IMAGE_API_KEY,
    MODEL_GATEWAY_IMAGE_TIMEOUT_MS: process.env.MODEL_GATEWAY_IMAGE_TIMEOUT_MS,
    MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES:
      process.env.MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES,
    MODEL_GATEWAY_TIMEOUT_MS: process.env.MODEL_GATEWAY_TIMEOUT_MS,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
    MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS,
  };
}

/**
 * 主配置解析：`parseModelGatewayConfiguration` 每次调用恰好解析一次环境。
 *
 * 本函数不缓存：每次 resolve* 调用重新解析，保证部署变更与测试注入立即生效。
 * 同一任务需要多个能力时用 `createWorkerModelRuntime`，一次解析共享全部能力，
 * 而不是多次重复解析同一份环境。
 */
function parsePrimaryConfiguration(
  environment: ModelGatewayEnvironment,
): EnabledModelGatewayConfiguration | null {
  const configuration = parseModelGatewayConfiguration(environment);
  return configuration.enabled ? configuration : null;
}

function readPrimaryConfiguration(): EnabledModelGatewayConfiguration | null {
  return parsePrimaryConfiguration(readModelGatewayEnvironment());
}

/** 媒体能力统一路由：继承主 Provider 或独立 override，能力不可用返回 null。 */
function resolveMediaConfiguration(
  capability: OverrideCapability,
): EnabledModelGatewayConfiguration | null {
  /* 同一调用内只读取一次环境，主配置与能力 override 共享这份转交面。 */
  const environment = readModelGatewayEnvironment();
  return resolveCapabilityGatewayConfiguration(
    environment,
    capability,
    parsePrimaryConfiguration(environment),
  );
}

/* worker 侧不手工构造请求体或解析 provider 原始响应：
   所有 schema 校验、密钥拼接、错误归一化都必须在 model-gateway 层完成，
   这确保 Worker 任务只有稳定错误码和可审计元数据。 */

export function resolveStructuredModelGateway(): StructuredModelGateway | null {
  const configuration = readPrimaryConfiguration();
  if (!configuration) return null;
  return new OpenAICompatibleStructuredModelGateway(configuration);
}

export function resolveSpeechModelGateway(): SpeechModelGateway | null {
  const configuration = resolveMediaConfiguration('speech');
  if (!configuration) return null;
  return new OpenAICompatibleSpeechModelGateway(configuration);
}

export function resolveAudioTranscriptionModelGateway(): AudioTranscriptionModelGateway | null {
  const configuration = resolveMediaConfiguration('transcription');
  if (!configuration) return null;
  return new OpenAICompatibleAudioTranscriptionModelGateway(configuration);
}

export function resolveImageGenerationModelGateway(): ImageGenerationModelGateway | null {
  const configuration = resolveMediaConfiguration('image');
  if (!configuration) return null;
  return new OpenAICompatibleImageGenerationModelGateway(configuration);
}

function embeddingConfiguration() {
  const configuration = resolveMediaConfiguration('embedding');
  return configuration &&
    configuration.modelIds.embedding &&
    configuration.embeddingModelVersion
    ? configuration
    : null;
}

export function resolveEmbeddingModelGateway(): EmbeddingModelGateway | null {
  const configuration = embeddingConfiguration();
  return configuration
    ? new OpenAICompatibleEmbeddingModelGateway(configuration)
    : null;
}

/**
 * 当前部署的语料侧向量身份。
 *
 * 它必须与适配器实际使用的模型、版本和指令逐字一致：写入端和检索端各自推导
 * 身份会在指令升级时悄悄错位，让新向量永远匹配不上查询。
 */
export function resolveEmbeddingRuntimeIdentity(): EmbeddingIdentity | null {
  const configuration = embeddingConfiguration();
  if (!configuration) return null;
  return {
    embeddingModel: configuration.modelIds.embedding!,
    embeddingModelVersion: configuration.embeddingModelVersion!,
    instruction: `passage:${EMBEDDING_INSTRUCTION_VERSION}`,
  };
}

/**
 * 任务级组合根（R03）：一次解析主配置，全部能力共享同一配置对象。
 *
 * 一个 worker 任务往往需要多个能力（如生成脚本同时要 structured 与 image），
 * 逐个调用 `resolve*` 会让同一份环境被重复解析。本入口把「解析一次 + 显式
 * 注入」收敛成单个构造调用：`parseModelGatewayConfiguration` 恰好执行一次，
 * 各能力 Gateway 只接收已验证配置，能力级错误按 ADR-0021 只关闭对应能力。
 *
 * 与 `resolve*` 不同，本入口接受显式环境 Record，不读取 `process.env`，
 * 便于测试注入与任务级显式转交。
 */
export interface WorkerModelRuntime {
  structured: StructuredModelGateway | null;
  speech: SpeechModelGateway | null;
  transcription: AudioTranscriptionModelGateway | null;
  image: ImageGenerationModelGateway | null;
  embedding: EmbeddingModelGateway | null;
  embeddingIdentity: EmbeddingIdentity | null;
}

export function createWorkerModelRuntime(
  environment: ModelGatewayEnvironment,
): WorkerModelRuntime {
  const primaryConfiguration = parsePrimaryConfiguration(environment);
  const resolveMedia = (
    capability: OverrideCapability,
  ): EnabledModelGatewayConfiguration | null =>
    resolveCapabilityGatewayConfiguration(
      environment,
      capability,
      primaryConfiguration,
    );
  const media = <T>(
    capability: OverrideCapability,
    constructor: new (config: EnabledModelGatewayConfiguration) => T,
  ): T | null => {
    const configuration = resolveMedia(capability);
    return configuration ? new constructor(configuration) : null;
  };
  const embeddingConfigurationFor =
    (): EnabledModelGatewayConfiguration | null => {
      const configuration = resolveMedia('embedding');
      return configuration &&
        configuration.modelIds.embedding &&
        configuration.embeddingModelVersion
        ? configuration
        : null;
    };
  const embedding = embeddingConfigurationFor();

  return {
    structured: primaryConfiguration
      ? new OpenAICompatibleStructuredModelGateway(primaryConfiguration)
      : null,
    speech: media('speech', OpenAICompatibleSpeechModelGateway),
    transcription: media(
      'transcription',
      OpenAICompatibleAudioTranscriptionModelGateway,
    ),
    image: media('image', OpenAICompatibleImageGenerationModelGateway),
    embedding: embedding
      ? new OpenAICompatibleEmbeddingModelGateway(embedding)
      : null,
    embeddingIdentity: embedding
      ? {
          embeddingModel: embedding.modelIds.embedding!,
          embeddingModelVersion: embedding.embeddingModelVersion!,
          instruction: `passage:${EMBEDDING_INSTRUCTION_VERSION}`,
        }
      : null,
  };
}
