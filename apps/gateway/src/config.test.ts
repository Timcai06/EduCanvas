import { describe, expect, it } from 'vitest';
import { readGatewayConfig } from './config';

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
    });
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
