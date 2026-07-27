import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  authRateLimitDeploymentReady,
  LocalAuthAttemptLimiter,
} from './rate-limit';

describe('LocalAuthAttemptLimiter', () => {
  it('在失败阈值返回稳定 retryAfterMs，并在窗口结束后恢复', () => {
    const limiter = new LocalAuthAttemptLimiter(2, 10_000);
    expect(limiter.fail('login:student', 1_000)).toEqual({ allowed: true });
    expect(limiter.fail('login:student', 2_000)).toEqual({
      allowed: false,
      retryAfterMs: 9_000,
    });
    expect(limiter.check('login:student', 2_500)).toEqual({
      allowed: false,
      retryAfterMs: 8_500,
    });
    expect(limiter.check('login:student', 11_000)).toEqual({ allowed: true });
  });

  it('成功后重置失败计数', () => {
    const limiter = new LocalAuthAttemptLimiter(2, 10_000);
    limiter.fail('login:student', 1_000);
    limiter.succeed('login:student');
    expect(limiter.fail('login:student', 2_000)).toEqual({ allowed: true });
  });

  it('不同认证主体互不影响', () => {
    const limiter = new LocalAuthAttemptLimiter(1, 10_000);
    expect(limiter.fail('login:first', 1_000).allowed).toBe(false);
    expect(limiter.check('login:second', 1_000)).toEqual({ allowed: true });
  });

  it('轮换主体键不能让本地失败窗口无界增长', () => {
    const limiter = new LocalAuthAttemptLimiter(1, 10_000, 2);
    limiter.fail('login:first', 1_000);
    limiter.fail('login:second', 2_000);
    limiter.fail('login:third', 3_000);

    expect(limiter.check('login:first', 3_000)).toEqual({ allowed: true });
    expect(limiter.check('login:third', 3_000).allowed).toBe(false);
  });
});

describe('认证限流部署门禁', () => {
  it('保持 local/test 与未显式配置的开发模式可用', () => {
    expect(authRateLimitDeploymentReady({})).toBe(true);
    expect(
      authRateLimitDeploymentReady({ EDUCANVAS_DEPLOYMENT_ENV: 'local' }),
    ).toBe(true);
    expect(
      authRateLimitDeploymentReady({ EDUCANVAS_DEPLOYMENT_ENV: 'test' }),
    ).toBe(true);
  });

  it('非本地部署必须显式声明共享上游限流', () => {
    expect(authRateLimitDeploymentReady({ NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(
      authRateLimitDeploymentReady({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
      }),
    ).toBe(false);
    expect(
      authRateLimitDeploymentReady({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
        EDUCANVAS_AUTH_RATE_LIMIT_MODE: 'shared-upstream',
      }),
    ).toBe(true);
  });
});
