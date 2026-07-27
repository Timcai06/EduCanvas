/**
 * 模型网关配置原语 — 稳定错误码、环境形状与共享解析函数。
 *
 * 单独成文件是为了让核心 Provider 路由（`config.ts`）与媒体能力配额
 * （`config-media.ts`）共享同一套校验语义而不互相 import，避免循环依赖。
 *
 * 安全约束：配置异常只暴露稳定错误码，绝不把 secret 或原始环境变量拼进消息。
 */

export const deploymentEnvironments = [
  'local',
  'development',
  'shared-dev',
  'test',
  'staging',
  'production',
] as const;

export type DeploymentEnvironment = (typeof deploymentEnvironments)[number];

/** 当前 OpenAI-compatible Adapter 家族的配置闭集，不是平台级 Provider Registry。 */
export const openAICompatibleProviders = [
  'deepseek',
  'openai-compatible',
] as const;

export type OpenAICompatibleProvider =
  (typeof openAICompatibleProviders)[number];

/** Turn Provider Adapter 的显式生产实现；native始终保留为默认回滚路径。 */
export const turnModelGatewayRuntimes = ['native', 'ai-sdk'] as const;

/** Turn Provider Adapter实现类型；只能由服务端组合根配置。 */
export type TurnModelGatewayRuntime = (typeof turnModelGatewayRuntimes)[number];

export const modelGatewayConfigurationErrorCodes = [
  'INVALID_ENVIRONMENT',
  'INVALID_PROVIDER',
  'INVALID_RUNTIME',
  'DEEPSEEK_FORBIDDEN',
  'INVALID_BOOLEAN',
  'MISSING_BASE_URL',
  'INVALID_BASE_URL',
  'MISSING_API_KEY',
  'INVALID_API_KEY',
  'MISSING_PRIMARY_MODEL',
  'INVALID_MODEL_ID',
  'INVALID_TIMEOUT',
  'INVALID_MAX_OUTPUT_TOKENS',
  'SPEECH_UNSUPPORTED_PROVIDER',
  'INVALID_SPEECH_VOICE',
  'INVALID_SPEECH_TIMEOUT',
  'INVALID_SPEECH_MAX_INPUT_CHARS',
  'TRANSCRIPTION_UNSUPPORTED_PROVIDER',
  'INVALID_TRANSCRIPTION_TIMEOUT',
  'INVALID_TRANSCRIPTION_MAX_INPUT_BYTES',
  'IMAGE_UNSUPPORTED_PROVIDER',
  'INVALID_IMAGE_TIMEOUT',
  'INVALID_IMAGE_MAX_OUTPUT_BYTES',
  'EMBEDDING_UNSUPPORTED_PROVIDER',
  'MISSING_EMBEDDING_MODEL_VERSION',
  'INVALID_EMBEDDING_MODEL_VERSION',
  'INVALID_EMBEDDING_TIMEOUT',
  'INVALID_EMBEDDING_MAX_BATCH',
] as const;

export type ModelGatewayConfigurationErrorCode =
  (typeof modelGatewayConfigurationErrorCodes)[number];

/** 配置异常只暴露稳定码，不能把 secret 或原始环境变量拼入消息。 */
export class ModelGatewayConfigurationError extends Error {
  override readonly name = 'ModelGatewayConfigurationError';

  constructor(readonly code: ModelGatewayConfigurationErrorCode) {
    super(code);
  }
}

export type ModelGatewayEnvironment = Readonly<
  Record<string, string | undefined>
>;

export const isOneOf = <Value extends string>(
  value: string,
  candidates: readonly Value[],
): value is Value => candidates.includes(value as Value);

export const trimmed = (value: string | undefined): string | undefined => {
  const result = value?.trim();
  return result === undefined || result.length === 0 ? undefined : result;
};

/** 空串与未设置等价于「未配置」；只有字面 true/false 才是合法布尔配置。 */
export const parseBoolean = (value: string | undefined): boolean => {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ModelGatewayConfigurationError('INVALID_BOOLEAN');
};

export const parseBoundedInteger = (
  value: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
  code: ModelGatewayConfigurationErrorCode,
): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < bounds.min ||
    parsed > bounds.max
  ) {
    throw new ModelGatewayConfigurationError(code);
  }
  return parsed;
};

/**
 * 供应商模型 ID 只允许显式配置，不内置默认值：把模型名写死在代码里会让
 * 供应商下线旧型号时变成一次代码发布，而不是一次配置修改。
 */
export const parseModelId = (
  value: string | undefined,
  required: boolean,
): string | undefined => {
  const modelId = trimmed(value);
  if (modelId === undefined) {
    if (required) {
      throw new ModelGatewayConfigurationError('MISSING_PRIMARY_MODEL');
    }
    return undefined;
  }
  if (modelId.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId)) {
    throw new ModelGatewayConfigurationError('INVALID_MODEL_ID');
  }
  return modelId;
};
