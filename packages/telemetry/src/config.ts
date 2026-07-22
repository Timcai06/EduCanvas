export const telemetryConfigurationErrorCodes = [
  'INVALID_SERVICE_NAME',
  'INVALID_BOOLEAN',
  'MISSING_ENDPOINT',
  'INVALID_ENDPOINT',
  'INVALID_SAMPLE_RATIO',
  'INVALID_EXPORT_TIMEOUT',
  'INVALID_HEADERS',
] as const;

export type TelemetryConfigurationErrorCode =
  (typeof telemetryConfigurationErrorCodes)[number];

/** 配置错误只携带稳定码，不得回显Endpoint、Header或Secret。 */
export class TelemetryConfigurationError extends Error {
  override readonly name = 'TelemetryConfigurationError';

  constructor(readonly code: TelemetryConfigurationErrorCode) {
    super(code);
  }
}

export type TelemetryEnvironment = Readonly<Record<string, string | undefined>>;

export type TelemetryConfiguration =
  | { enabled: false; serviceName: string }
  | {
      enabled: true;
      serviceName: string;
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      sampleRatio: number;
      exportTimeoutMs: number;
    };

const trimmed = (value: string | undefined): string | undefined => {
  const result = value?.trim();
  return result === undefined || result.length === 0 ? undefined : result;
};

const parseEnabled = (value: string | undefined): boolean => {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new TelemetryConfigurationError('INVALID_BOOLEAN');
};

const parseEndpoint = (
  value: string | undefined,
  deploymentEnvironment: string | undefined,
): string => {
  const raw = trimmed(value);
  if (raw === undefined) {
    throw new TelemetryConfigurationError('MISSING_ENDPOINT');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new TelemetryConfigurationError('INVALID_ENDPOINT');
  }
  if (
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    !['http:', 'https:'].includes(endpoint.protocol)
  ) {
    throw new TelemetryConfigurationError('INVALID_ENDPOINT');
  }
  const productionLike = ['staging', 'production'].includes(
    deploymentEnvironment ?? '',
  );
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(
    endpoint.hostname,
  );
  if (
    (productionLike && endpoint.protocol !== 'https:') ||
    (endpoint.protocol === 'http:' && !loopback)
  ) {
    throw new TelemetryConfigurationError('INVALID_ENDPOINT');
  }
  return endpoint.toString();
};

const parseSampleRatio = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') return 0.1;
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new TelemetryConfigurationError('INVALID_SAMPLE_RATIO');
  }
  return ratio;
};

const parseExportTimeout = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') return 3_000;
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000) {
    throw new TelemetryConfigurationError('INVALID_EXPORT_TIMEOUT');
  }
  return timeout;
};

const parseHeaders = (value: string | undefined): Record<string, string> => {
  const raw = trimmed(value);
  if (raw === undefined) return {};
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw) as unknown;
  } catch {
    throw new TelemetryConfigurationError('INVALID_HEADERS');
  }
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate) ||
    Object.keys(candidate).length > 16
  ) {
    throw new TelemetryConfigurationError('INVALID_HEADERS');
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(candidate)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) ||
      ['host', 'content-length'].includes(name.toLowerCase()) ||
      typeof headerValue !== 'string' ||
      headerValue.length === 0 ||
      headerValue.length > 1_024 ||
      /[\r\n]/.test(headerValue)
    ) {
      throw new TelemetryConfigurationError('INVALID_HEADERS');
    }
    headers[name] = headerValue;
  }
  return headers;
};

/** 从组合根传入的显式环境解析OTel配置；disabled时不读取其他遥测变量。 */
export function parseTelemetryConfiguration(
  serviceName: string,
  environment: TelemetryEnvironment,
): TelemetryConfiguration {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(serviceName)) {
    throw new TelemetryConfigurationError('INVALID_SERVICE_NAME');
  }
  if (!parseEnabled(environment.EDUCANVAS_OTEL_ENABLED)) {
    return { enabled: false, serviceName };
  }
  return {
    enabled: true,
    serviceName,
    endpoint: parseEndpoint(
      environment.EDUCANVAS_OTEL_EXPORTER_OTLP_ENDPOINT,
      environment.EDUCANVAS_DEPLOYMENT_ENV,
    ),
    headers: parseHeaders(environment.EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON),
    sampleRatio: parseSampleRatio(environment.EDUCANVAS_OTEL_SAMPLE_RATIO),
    exportTimeoutMs: parseExportTimeout(
      environment.EDUCANVAS_OTEL_EXPORT_TIMEOUT_MS,
    ),
  };
}
