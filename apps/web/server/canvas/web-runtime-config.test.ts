import { describe, expect, it } from 'vitest';

import { vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  readWebRuntimeHostConfig,
  WebRuntimeHostConfigurationError,
} from './web-runtime-config';

describe('web runtime host configuration', () => {
  it('accepts the explicit hostname/IP cross-site test boundary', () => {
    expect(
      readWebRuntimeHostConfig({
        EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN: 'http://localhost:3300',
        EDUCANVAS_WEB_PUBLIC_ORIGIN: 'http://127.0.0.1:3100',
        EDUCANVAS_DEPLOYMENT_ENV: 'test',
      }),
    ).toEqual({
      runtimeOrigin: 'http://localhost:3300',
      webOrigin: 'http://127.0.0.1:3100',
    });
  });

  it('rejects a port-only boundary', () => {
    expect(() =>
      readWebRuntimeHostConfig({
        EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN: 'https://learn.example.com:3300',
        EDUCANVAS_WEB_PUBLIC_ORIGIN: 'https://learn.example.com:3100',
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
      }),
    ).toThrow(WebRuntimeHostConfigurationError);
  });
});
