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
function readModelGatewayEnvironment(): ModelGatewayEnvironment {
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
  };
}

/**
 * 主配置解析一次并缓存本轮：媒体能力解析需要主 Provider 与部署环境，
 * 各能力共享同一主配置，避免重复解析带来不一致。
 */
function readPrimaryConfiguration(): EnabledModelGatewayConfiguration | null {
  const configuration = parseModelGatewayConfiguration(
    readModelGatewayEnvironment(),
  );
  return configuration.enabled ? configuration : null;
}

/** 媒体能力统一路由：继承主 Provider 或独立 override，能力不可用返回 null。 */
function resolveMediaConfiguration(
  capability: OverrideCapability,
): EnabledModelGatewayConfiguration | null {
  return resolveCapabilityGatewayConfiguration(
    readModelGatewayEnvironment(),
    capability,
    readPrimaryConfiguration(),
  );
}

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
