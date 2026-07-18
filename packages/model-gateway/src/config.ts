import type { ModelAlias } from '@educanvas/agent-core';

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

export const modelGatewayConfigurationErrorCodes = [
  'INVALID_ENVIRONMENT',
  'INVALID_PROVIDER',
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

export interface DisabledModelGatewayConfiguration {
  enabled: false;
  environment: DeploymentEnvironment;
  reason: 'not_configured' | 'deepseek_not_enabled';
}

export interface EnabledModelGatewayConfiguration {
  enabled: true;
  environment: DeploymentEnvironment;
  provider: OpenAICompatibleProvider;
  baseUrl: string;
  apiKey: string;
  modelIds: Readonly<Partial<Record<ModelAlias, string>>> & {
    primary: string;
  };
  timeoutMs: number;
  maxOutputTokens: number;
  speechVoice: string;
  speechTimeoutMs: number;
  speechMaxInputChars: number;
}

export type ModelGatewayConfiguration =
  DisabledModelGatewayConfiguration | EnabledModelGatewayConfiguration;

export type ModelGatewayEnvironment = Readonly<
  Record<string, string | undefined>
>;

const isOneOf = <Value extends string>(
  value: string,
  candidates: readonly Value[],
): value is Value => candidates.includes(value as Value);

const trimmed = (value: string | undefined): string | undefined => {
  const result = value?.trim();
  return result === undefined || result.length === 0 ? undefined : result;
};

const parseBoolean = (value: string | undefined): boolean => {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ModelGatewayConfigurationError('INVALID_BOOLEAN');
};

const parseInteger = (
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

const parseModelId = (
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

const parseSpeechVoice = (value: string | undefined): string => {
  const voice = trimmed(value) ?? 'alloy';
  if (voice.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(voice)) {
    throw new ModelGatewayConfigurationError('INVALID_SPEECH_VOICE');
  }
  return voice;
};

const parseBaseUrl = (
  value: string | undefined,
  environment: DeploymentEnvironment,
  provider: OpenAICompatibleProvider,
): string => {
  const raw = trimmed(value);
  if (raw === undefined) {
    throw new ModelGatewayConfigurationError('MISSING_BASE_URL');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelGatewayConfigurationError('INVALID_BASE_URL');
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    throw new ModelGatewayConfigurationError('INVALID_BASE_URL');
  }
  if (
    ['staging', 'production'].includes(environment) &&
    url.protocol !== 'https:'
  ) {
    throw new ModelGatewayConfigurationError('INVALID_BASE_URL');
  }
  if (
    provider === 'deepseek' &&
    (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com')
  ) {
    throw new ModelGatewayConfigurationError('INVALID_BASE_URL');
  }
  return url.toString().replace(/\/$/, '');
};

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

  const apiKey = trimmed(environmentValues.MODEL_GATEWAY_API_KEY);
  if (apiKey === undefined) {
    throw new ModelGatewayConfigurationError('MISSING_API_KEY');
  }
  if (apiKey.length > 4_096 || !/^[\x21-\x7e]+$/.test(apiKey)) {
    throw new ModelGatewayConfigurationError('INVALID_API_KEY');
  }
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
  const speech = parseModelId(
    environmentValues.MODEL_GATEWAY_SPEECH_MODEL,
    false,
  );
  if (speech !== undefined && provider !== 'openai-compatible') {
    throw new ModelGatewayConfigurationError('SPEECH_UNSUPPORTED_PROVIDER');
  }
  const modelIds: EnabledModelGatewayConfiguration['modelIds'] = {
    primary,
    ...(fast === undefined ? {} : { fast }),
    ...(structured === undefined ? {} : { structured }),
    ...(speech === undefined ? {} : { speech }),
  };

  return {
    enabled: true,
    environment,
    provider,
    baseUrl: parseBaseUrl(
      environmentValues.MODEL_GATEWAY_BASE_URL,
      environment,
      provider,
    ),
    apiKey,
    modelIds,
    timeoutMs: parseInteger(
      environmentValues.MODEL_GATEWAY_TIMEOUT_MS,
      30_000,
      { min: 1_000, max: 120_000 },
      'INVALID_TIMEOUT',
    ),
    maxOutputTokens: parseInteger(
      environmentValues.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
      2_048,
      { min: 1, max: 65_536 },
      'INVALID_MAX_OUTPUT_TOKENS',
    ),
    speechVoice: parseSpeechVoice(
      environmentValues.MODEL_GATEWAY_SPEECH_VOICE,
    ),
    speechTimeoutMs: parseInteger(
      environmentValues.MODEL_GATEWAY_SPEECH_TIMEOUT_MS,
      60_000,
      { min: 1_000, max: 180_000 },
      'INVALID_SPEECH_TIMEOUT',
    ),
    speechMaxInputChars: parseInteger(
      environmentValues.MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS,
      3_500,
      { min: 80, max: 4_096 },
      'INVALID_SPEECH_MAX_INPUT_CHARS',
    ),
  };
}
