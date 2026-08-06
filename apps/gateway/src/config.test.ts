import { describe, expect, it } from 'vitest';
import { normalizeWsAllowedOrigin, readGatewayConfig } from './config';

describe('Gateway config', () => {
  it('uses an isolated default port and disables internal transport by default', () => {
    expect(readGatewayConfig({})).toEqual({
      host: '127.0.0.1',
      port: 3200,
      internalToken: null,
      bootstrapToken: null,
      sessionSecret: null,
      localOnboardingEnabled: false,
      localUserId: 'local:owner',
      // 本地 Web 默认 3101（README），127.0.0.1 与 localhost 两种访问形态。
      wsAllowedOrigins: ['http://127.0.0.1:3101', 'http://localhost:3101'],
    });
  });

  it('解析 WS Origin 白名单环境变量并规范化', () => {
    expect(
      readGatewayConfig({
        EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS:
          'https://app.example.com, http://localhost:3101/',
      }).wsAllowedOrigins,
    ).toEqual(['https://app.example.com', 'http://localhost:3101']);
    expect(
      readGatewayConfig({
        EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS: '  ,  ',
      }).wsAllowedOrigins,
    ).toEqual(['http://127.0.0.1:3101', 'http://localhost:3101']);
  });

  it('拒绝带路径/凭据/非法 URL 的 Origin 配置', () => {
    for (const bad of [
      'http://app.example.com/path',
      'http://user:pass@app.example.com',
      'http://app.example.com?x=1',
      'ftp://app.example.com',
      'not-a-url',
      'http://',
    ]) {
      expect(
        () =>
          readGatewayConfig({
            EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS: bad,
          }),
        `should reject ${bad}`,
      ).toThrow(/EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS/);
    }
  });

  it('normalizeWsAllowedOrigin 规范化合法 Origin 并拒绝非法形态', () => {
    expect(normalizeWsAllowedOrigin('http://localhost:3101/')).toBe(
      'http://localhost:3101',
    );
    expect(normalizeWsAllowedOrigin('HTTPS://EXAMPLE.COM')).toBe(
      'https://example.com',
    );
    expect(normalizeWsAllowedOrigin('http://example.com:8080/path')).toBeNull();
    expect(normalizeWsAllowedOrigin('http://user@example.com')).toBeNull();
    expect(normalizeWsAllowedOrigin('  ')).toBeNull();
    expect(normalizeWsAllowedOrigin('javascript:alert(1)')).toBeNull();
  });

  it('disables local onboarding outside local loopback deployments', () => {
    expect(
      readGatewayConfig({ EDUCANVAS_DEPLOYMENT_ENV: 'production' })
        .localOnboardingEnabled,
    ).toBe(false);
    expect(
      readGatewayConfig({
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
        EDUCANVAS_GATEWAY_HOST: '0.0.0.0',
      }).localOnboardingEnabled,
    ).toBe(false);
    expect(
      readGatewayConfig({ EDUCANVAS_DEPLOYMENT_ENV: 'local' })
        .localOnboardingEnabled,
    ).toBe(true);
  });

  it('rejects short internal credentials', () => {
    expect(() =>
      readGatewayConfig({ EDUCANVAS_GATEWAY_INTERNAL_TOKEN: 'short' }),
    ).toThrow(/32/);
  });

  it('rejects invalid ports', () => {
    expect(() => readGatewayConfig({ EDUCANVAS_GATEWAY_PORT: '0' })).toThrow(
      /1..65535/,
    );
    expect(() =>
      readGatewayConfig({ EDUCANVAS_GATEWAY_PORT: '70000' }),
    ).toThrow(/1..65535/);
  });
});
