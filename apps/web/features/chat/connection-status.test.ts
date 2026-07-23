import { describe, expect, it } from 'vitest';
import { resolveTurnFailureMessage } from './connection-status';

describe('resolveTurnFailureMessage', () => {
  it('attributes failures to the local network when offline, always retryable', () => {
    const resolved = resolveTurnFailureMessage({
      online: false,
      serverMessage: 'AI 老师暂时无法连接，请稍后重试。',
      serverRetryable: false,
    });
    expect(resolved.retryable).toBe(true);
    expect(resolved.message).toContain('网络');
    /* 离线时绝不甩锅给"AI 老师" */
    expect(resolved.message).not.toContain('AI 老师');
  });

  it('passes the server-safe message through when online', () => {
    const resolved = resolveTurnFailureMessage({
      online: true,
      serverMessage: 'AI 老师暂时无法连接，请稍后重试。',
      serverRetryable: false,
    });
    expect(resolved.message).toBe('AI 老师暂时无法连接，请稍后重试。');
    expect(resolved.retryable).toBe(false);
  });

  it('preserves server retryability when online', () => {
    expect(
      resolveTurnFailureMessage({
        online: true,
        serverMessage: '请求太频繁了。',
        serverRetryable: true,
      }).retryable,
    ).toBe(true);
  });
});
