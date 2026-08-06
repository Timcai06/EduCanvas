import { describe, expect, it } from 'vitest';
import {
  classifyHttpStatus,
  isAbortError,
  isRetryableResourceError,
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
