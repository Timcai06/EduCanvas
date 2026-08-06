import { describe, expect, it } from 'vitest';
import {
  LatestRequestGuard,
  ResourceClientError,
  classifyHttpStatus,
  isAbortError,
  isRetryableResourceError,
  toClientError,
  toOfflineError,
} from './resource-error';

describe('classifyHttpStatus（HTTP status → 错误语义）', () => {
  it('401/403 → forbidden（权限不足，不可重试）', () => {
    expect(classifyHttpStatus(401)).toBe('forbidden');
    expect(classifyHttpStatus(403)).toBe('forbidden');
  });

  it('404 → not_found（资源不存在，不可重试）', () => {
    expect(classifyHttpStatus(404)).toBe('not_found');
  });

  it('503 → unavailable（服务不可用，可重试）', () => {
    expect(classifyHttpStatus(503)).toBe('unavailable');
  });

  it('其它 4xx/5xx → failed', () => {
    expect(classifyHttpStatus(500)).toBe('failed');
    expect(classifyHttpStatus(502)).toBe('failed');
    expect(classifyHttpStatus(400)).toBe('failed');
  });
});

describe('isRetryableResourceError（Retry 只对可重试错误开放）', () => {
  it('unavailable / offline / failed 可重试', () => {
    expect(isRetryableResourceError('unavailable')).toBe(true);
    expect(isRetryableResourceError('offline')).toBe(true);
    expect(isRetryableResourceError('failed')).toBe(true);
  });

  it('forbidden / not_found / empty 不可重试（重试无意义）', () => {
    expect(isRetryableResourceError('forbidden')).toBe(false);
    expect(isRetryableResourceError('not_found')).toBe(false);
    expect(isRetryableResourceError('empty')).toBe(false);
  });
});

describe('isAbortError（取消不是失败）', () => {
  it('AbortError → true（竞态取消应被忽略）', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('普通 Error / TypeError → false', () => {
    expect(isAbortError(new Error('network'))).toBe(false);
    expect(isAbortError(new TypeError('fetch failed'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('string')).toBe(false);
  });
});

describe('toOfflineError（网络层失败）', () => {
  it('返回 offline 语义 + 稳定文案', () => {
    expect(
      toOfflineError(new TypeError('fetch failed'), '网络连接不可用。'),
    ).toEqual({
      kind: 'offline',
      message: '网络连接不可用。',
    });
  });
});

describe('ResourceClientError（带语义的客户端错误）', () => {
  it('继承 Error（instanceof 仍成立）且携带 kind', () => {
    const error = new ResourceClientError('forbidden', '没有权限。');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ResourceClientError');
    expect(error.kind).toBe('forbidden');
    expect(error.message).toBe('没有权限。');
  });
});

describe('LatestRequestGuard（竞态闸门，latest wins）', () => {
  it('单个请求完成后 isCurrent 为 true（结果可提交）', () => {
    const guard = new LatestRequestGuard();
    const isCurrent = guard.begin();
    expect(isCurrent()).toBe(true);
  });

  it('并发请求：旧请求在更新请求发出后 isCurrent 为 false（结果应丢弃）', () => {
    const guard = new LatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('新请求发出后首个请求不可提交，后续依旧各自判定', () => {
    const guard = new LatestRequestGuard();
    const a = guard.begin();
    const b = guard.begin();
    const c = guard.begin();
    expect(a()).toBe(false);
    expect(b()).toBe(false);
    expect(c()).toBe(true);
  });
});

describe('toClientError（未知原因规整）', () => {
  it('已是 ResourceClientError 时原样透传（保留 kind）', () => {
    const error = new ResourceClientError('offline', '网络不可用。');
    expect(toClientError(error, 'fallback')).toBe(error);
  });

  it('其它原因统一归为 failed + fallback 文案', () => {
    expect(toClientError(new Error('boom'), '加载失败。')).toMatchObject({
      kind: 'failed',
      message: '加载失败。',
    });
    expect(toClientError(null, '加载失败。')).toMatchObject({
      kind: 'failed',
      message: '加载失败。',
    });
    expect(toClientError('oops', '加载失败。')).toMatchObject({
      kind: 'failed',
      message: '加载失败。',
    });
  });
});
