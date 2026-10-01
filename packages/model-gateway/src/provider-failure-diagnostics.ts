import {
  normalizedModelErrorCodes,
  type NormalizedModelError,
} from '@educanvas/agent-core';

/** 全环境诊断只含固定分类和HTTP状态；不读取body、URL、Prompt或供应商异常。 */
export function logProviderFailure(
  provider: string,
  error: NormalizedModelError,
  status?: number,
): void {
  const normalizedCode = normalizedModelErrorCodes.includes(error.code)
    ? error.code
    : 'unknown';
  const safeStatus =
    Number.isInteger(status) && status! >= 100 && status! <= 599
      ? status
      : undefined;
  const event =
    safeStatus === 400 || safeStatus === 422
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
        provider === 'openai-compatible' || provider === 'deepseek'
          ? provider
          : 'unknown',
      ...(safeStatus === undefined ? {} : { status: safeStatus }),
      normalizedCode,
      retryable: error.retryable === true,
    }),
  );
}
