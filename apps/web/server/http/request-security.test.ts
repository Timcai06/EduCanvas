import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from './request-security';

describe('cookie write request security', () => {
  it('接受精确同源并拒绝跨源、畸形 Origin', () => {
    expect(
      isTrustedSameOriginWrite(
        new Request('https://learn.example/api', {
          headers: { origin: 'https://learn.example' },
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedSameOriginWrite(
        new Request('https://learn.example/api', {
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedSameOriginWrite(
        new Request('https://learn.example/api', {
          headers: { origin: 'not a url' },
        }),
      ),
    ).toBe(false);
  });

  it('允许 Next.js 内部 URL 与浏览器 Host 不同但 Host/Origin 精确一致', () => {
    expect(
      isTrustedSameOriginWrite(
        new Request('http://localhost:3100/api', {
          headers: {
            host: '127.0.0.1:3100',
            origin: 'http://127.0.0.1:3100',
          },
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedSameOriginWrite(
        new Request('http://localhost:3100/api', {
          headers: {
            host: '127.0.0.1:3100',
            origin: 'https://evil.example',
          },
        }),
      ),
    ).toBe(false);
  });

  it('无 Origin 时拒绝浏览器明确标记的 cross-site 请求', () => {
    expect(
      isTrustedSameOriginWrite(
        new Request('https://learn.example/api', {
          headers: { 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedSameOriginWrite(new Request('https://learn.example/api')),
    ).toBe(true);
  });

  it('错误响应使用稳定 JSON、no-store 与 Retry-After', async () => {
    const response = jsonError(429, 'rate_limited', {
      retryAfterMs: 1_250,
      requestId: 'request-1',
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('retry-after')).toBe('2');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-request-id')).toBe('request-1');
    expect(await response.json()).toEqual({
      error: {
        code: 'rate_limited',
        requestId: 'request-1',
      },
    });
  });

  it('恶意错误内容不会进入公共 envelope', async () => {
    const secret = 'sk-provider-token SQL /Users/tim/private prompt stack';
    const response = jsonError(500, secret, { requestId: secret });
    const serialized = await response.text();
    expect(serialized).toContain('internal_error');
    expect(serialized).not.toContain(secret);
  });

  it('成功 JSON 响应同样使用私有 no-store 与请求 ID', async () => {
    const response = jsonResponse(
      { ok: true },
      { status: 201, requestId: 'request-2' },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-request-id')).toBe('request-2');
    expect(await response.json()).toEqual({ ok: true });
  });
});
