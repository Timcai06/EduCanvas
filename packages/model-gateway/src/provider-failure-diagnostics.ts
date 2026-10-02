import {
  ModelGatewayInvocationError,
  normalizedModelErrorCodes,
  type NormalizedModelError,
} from '@educanvas/agent-core';

const capabilities = [
  'turn',
  'structured',
  'embedding',
  'image',
  'speech',
  'transcription',
  'streaming_speech',
  'streaming_transcription',
] as const;
const stages = [
  'precondition',
  'request_build',
  'provider_call',
  'response_parse',
  'audio_download',
  'stream',
] as const;
const failureClasses = [
  'precondition_failed',
  'request_build_failed',
  'request_rejected',
  'response_invalid',
  'provider_failure',
  'cancelled',
] as const;

/** @internal 只携带已经从 Adapter 边界提取的低敏值，绝不接收 Response 或异常。 */
export interface ProviderFailureDiagnostic {
  capability?: (typeof capabilities)[number];
  stage?: (typeof stages)[number];
  failureClass?: (typeof failureClasses)[number];
  status?: number;
  providerErrorCode?: unknown;
  providerErrorType?: unknown;
}

const providerErrorCodes = [
  'invalid_api_key',
  'insufficient_quota',
  'context_length_exceeded',
  'model_not_found',
  'INVALID_API_KEY',
] as const;
const providerErrorTypes = [
  'invalid_request_error',
  'authentication_error',
  'rate_limit_error',
  'server_error',
  'permission_error',
  'not_found_error',
] as const;

/** @internal 长度/字符过滤不能防止格式合法的秘密；只有精确闭集能进入日志。 */
export function safeProviderErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' &&
    providerErrorCodes.some((code) => code === value)
    ? value
    : undefined;
}

const safeProviderErrorType = (value: unknown): string | undefined =>
  typeof value === 'string' && providerErrorTypes.some((type) => type === value)
    ? value
    : undefined;

/** 全环境诊断只含闭集分类与HTTP状态；不读取body、URL、Prompt或异常内容。 */
export function logProviderFailure(
  provider: string,
  error: NormalizedModelError,
  status?: number,
  diagnostic: ProviderFailureDiagnostic = {},
): void {
  const normalizedCode = normalizedModelErrorCodes.includes(error.code)
    ? error.code
    : 'unknown';
  const candidateStatus = status ?? diagnostic.status;
  const safeStatus =
    Number.isInteger(candidateStatus) &&
    candidateStatus! >= 100 &&
    candidateStatus! <= 599
      ? candidateStatus
      : undefined;
  const failureClass = failureClasses.some(
    (value) => value === diagnostic.failureClass,
  )
    ? diagnostic.failureClass
    : diagnostic.stage === 'precondition'
      ? 'precondition_failed'
      : diagnostic.stage === 'request_build'
        ? 'request_build_failed'
        : safeStatus === 400 || safeStatus === 422
          ? 'request_rejected'
          : normalizedCode === 'aborted'
            ? 'cancelled'
            : safeStatus !== undefined && safeStatus >= 300
              ? 'provider_failure'
              : normalizedCode === 'invalid_response'
                ? 'response_invalid'
                : 'provider_failure';
  const event =
    failureClass === 'request_build_failed' ||
    failureClass === 'precondition_failed'
      ? `provider_${failureClass}`
      : safeStatus === 400 || safeStatus === 422
        ? 'provider_request_rejected'
        : safeStatus === 401 || safeStatus === 403
          ? 'provider_unauthorized'
          : `provider_${normalizedCode}`;
  console.warn(
    JSON.stringify({
      schema: 'educanvas.log.v1',
      ts: new Date().toISOString(),
      level: 'warn',
      service: 'model-gateway',
      event,
      message: 'Model Provider call failed',
      provider:
        provider === 'openai-compatible' ||
        provider === 'deepseek' ||
        provider === 'dashscope'
          ? provider
          : 'unknown',
      ...(safeStatus === undefined ? {} : { status: safeStatus }),
      normalizedCode,
      retryable: error.retryable === true,
      failureClass,
      ...(capabilities.some((value) => value === diagnostic.capability)
        ? { capability: diagnostic.capability }
        : {}),
      ...(stages.some((value) => value === diagnostic.stage)
        ? { stage: diagnostic.stage }
        : {}),
      ...(safeProviderErrorCode(diagnostic.providerErrorCode) === undefined
        ? {}
        : {
            providerErrorCode: safeProviderErrorCode(
              diagnostic.providerErrorCode,
            ),
          }),
      ...(safeProviderErrorType(diagnostic.providerErrorType) === undefined
        ? {}
        : {
            providerErrorType: safeProviderErrorType(
              diagnostic.providerErrorType,
            ),
          }),
    }),
  );
}

/** @internal 终止边界只读取已归一化异常，未知异常不读取 message、cause 或 stack。 */
export function logProviderInvocationFailure(
  provider: string,
  error: unknown,
  diagnostic: ProviderFailureDiagnostic,
): void {
  const normalized: NormalizedModelError =
    error instanceof ModelGatewayInvocationError
      ? error.normalized
      : { code: 'unavailable', retryable: true };
  logProviderFailure(provider, normalized, undefined, diagnostic);
}
