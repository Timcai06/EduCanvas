import { describe, expect, it } from 'vitest';
import {
  parseTelemetryConfiguration,
  TelemetryConfigurationError,
} from './config';

const enabledEnvironment = {
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  EDUCANVAS_OTEL_ENABLED: 'true',
  EDUCANVAS_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
};

describe('parseTelemetryConfiguration', () => {
  it('默认关闭且不读取其余Exporter配置', () => {
    expect(
      parseTelemetryConfiguration('educanvas-web', {
        EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON: 'not-json-secret',
      }),
    ).toEqual({ enabled: false, serviceName: 'educanvas-web' });
  });

  it('解析有界采样、超时与受控Header', () => {
    expect(
      parseTelemetryConfiguration('educanvas-gateway', {
        ...enabledEnvironment,
        EDUCANVAS_OTEL_SAMPLE_RATIO: '0.25',
        EDUCANVAS_OTEL_EXPORT_TIMEOUT_MS: '2500',
        EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON:
          '{"authorization":"Bearer fixture-never-real"}',
      }),
    ).toEqual({
      enabled: true,
      serviceName: 'educanvas-gateway',
      endpoint: 'http://127.0.0.1:4318/v1/traces',
      headers: { authorization: 'Bearer fixture-never-real' },
      sampleRatio: 0.25,
      exportTimeoutMs: 2_500,
    });
  });

  it('生产拒绝明文Endpoint且配置异常不回显Secret', () => {
    expect(() =>
      parseTelemetryConfiguration('educanvas-worker', {
        ...enabledEnvironment,
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<TelemetryConfigurationError>>({
        code: 'INVALID_ENDPOINT',
      }),
    );
    const secret = 'fixture-header-secret-never-log';
    let error: unknown;
    try {
      parseTelemetryConfiguration('educanvas-web', {
        ...enabledEnvironment,
        EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON: `{"authorization":"${secret}\r\nunsafe"}`,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'INVALID_HEADERS' });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it.each(['-0.1', '1.1', 'NaN'])('拒绝非法采样率%s', (sampleRatio) => {
    expect(() =>
      parseTelemetryConfiguration('educanvas-web', {
        ...enabledEnvironment,
        EDUCANVAS_OTEL_SAMPLE_RATIO: sampleRatio,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<TelemetryConfigurationError>>({
        code: 'INVALID_SAMPLE_RATIO',
      }),
    );
  });
});
