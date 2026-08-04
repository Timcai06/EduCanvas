import { describe, expect, it } from 'vitest';
import { readWebRuntimeConfig, WebRuntimeConfigurationError } from './config';

const baseline = {
  EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN: 'http://localhost:3300',
  EDUCANVAS_WEB_PUBLIC_ORIGIN: 'http://127.0.0.1:3100',
  EDUCANVAS_DEPLOYMENT_ENV: 'test',
};

describe('web runtime origin/process configuration', () => {
  it('accepts the explicit cross-site local boundary', () => {
    expect(readWebRuntimeConfig(baseline)).toMatchObject({
      publicOrigin: 'http://localhost:3300',
      webOrigin: 'http://127.0.0.1:3100',
    });
  });

  it.each([
    ['same origin', 'https://learn.example.com', 'https://learn.example.com'],
    [
      'ports only',
      'https://learn.example.com:3300',
      'https://learn.example.com:3100',
    ],
    [
      'same registrable site',
      'https://runtime.example.com',
      'https://learn.example.com',
    ],
  ])('rejects %s as an isolation boundary', (_label, runtime, web) => {
    expect(() =>
      readWebRuntimeConfig({
        ...baseline,
        EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN: runtime,
        EDUCANVAS_WEB_PUBLIC_ORIGIN: web,
      }),
    ).toThrow(WebRuntimeConfigurationError);
  });

  it('requires HTTPS for both production sites', () => {
    expect(() =>
      readWebRuntimeConfig({
        ...baseline,
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
      }),
    ).toThrow(WebRuntimeConfigurationError);
  });
});
