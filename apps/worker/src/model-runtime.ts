import type {
  SpeechModelGateway,
  StructuredModelGateway,
} from '@educanvas/agent-core';
import {
  OpenAICompatibleSpeechModelGateway,
  OpenAICompatibleStructuredModelGateway,
  parseModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from '@educanvas/model-gateway';

/**
 * worker 是非对话模型任务的唯一调用方(ADR-0012)。与 Web 组合根同一纪律:
 * 显式转交环境变量、未配置返回 null 由调用方诚实降级/失败,Key 不出适配器。
 */
function readModelGatewayEnvironment(): ModelGatewayEnvironment {
  return {
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
    MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
    MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
    MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
    MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
    MODEL_GATEWAY_FAST_MODEL: process.env.MODEL_GATEWAY_FAST_MODEL,
    MODEL_GATEWAY_STRUCTURED_MODEL: process.env.MODEL_GATEWAY_STRUCTURED_MODEL,
    MODEL_GATEWAY_SPEECH_MODEL: process.env.MODEL_GATEWAY_SPEECH_MODEL,
    MODEL_GATEWAY_SPEECH_VOICE: process.env.MODEL_GATEWAY_SPEECH_VOICE,
    MODEL_GATEWAY_SPEECH_TIMEOUT_MS:
      process.env.MODEL_GATEWAY_SPEECH_TIMEOUT_MS,
    MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS:
      process.env.MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS,
    MODEL_GATEWAY_TIMEOUT_MS: process.env.MODEL_GATEWAY_TIMEOUT_MS,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
  };
}

export function resolveStructuredModelGateway(): StructuredModelGateway | null {
  const configuration = parseModelGatewayConfiguration(
    readModelGatewayEnvironment(),
  );
  if (!configuration.enabled) return null;
  return new OpenAICompatibleStructuredModelGateway(configuration);
}

export function resolveSpeechModelGateway(): SpeechModelGateway | null {
  const configuration = parseModelGatewayConfiguration(
    readModelGatewayEnvironment(),
  );
  if (
    !configuration.enabled ||
    configuration.provider !== 'openai-compatible' ||
    !configuration.modelIds.speech
  ) {
    return null;
  }
  return new OpenAICompatibleSpeechModelGateway(configuration);
}
