import 'server-only';

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOCAL_WINDOWS = 10_000;
const SHARED_UPSTREAM_MODE = 'shared-upstream';

type FailureWindow = {
  failures: number;
  expiresAt: number;
};

/** 认证尝试的稳定限流结果。 */
export type AuthAttemptDecision =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * 仅供 local/development/test 使用的单进程失败窗口。
 * 非本地部署必须声明共享上游限流，不能把本实现当成跨实例安全边界。
 */
export class LocalAuthAttemptLimiter {
  private readonly windows = new Map<string, FailureWindow>();

  constructor(
    private readonly maxFailures = MAX_FAILURES,
    private readonly windowMs = FAILURE_WINDOW_MS,
    private readonly maxWindows = MAX_LOCAL_WINDOWS,
  ) {
    if (
      !Number.isSafeInteger(maxFailures) ||
      !Number.isSafeInteger(windowMs) ||
      !Number.isSafeInteger(maxWindows) ||
      maxFailures < 1 ||
      windowMs < 1 ||
      maxWindows < 1
    ) {
      throw new Error('认证限流参数必须为正整数');
    }
  }

  /** 在执行高成本认证操作前检查当前失败窗口。 */
  check(key: string, now = Date.now()): AuthAttemptDecision {
    const window = this.activeWindow(key, now);
    if (!window || window.failures < this.maxFailures) {
      return { allowed: true };
    }
    return {
      allowed: false,
      retryAfterMs: Math.max(1, window.expiresAt - now),
    };
  }

  /** 记录一次可归因的认证失败；达到阈值的本次请求直接返回限流。 */
  fail(key: string, now = Date.now()): AuthAttemptDecision {
    const current = this.activeWindow(key, now);
    if (!current && this.windows.size >= this.maxWindows) {
      this.pruneExpired(now);
      if (this.windows.size >= this.maxWindows) {
        const oldestKey = this.windows.keys().next().value;
        if (oldestKey !== undefined) this.windows.delete(oldestKey);
      }
    }
    const window = current ?? {
      failures: 0,
      expiresAt: now + this.windowMs,
    };
    window.failures += 1;
    this.windows.set(key, window);
    return this.check(key, now);
  }

  /** 成功认证后清除同一主体的失败窗口。 */
  succeed(key: string): void {
    this.windows.delete(key);
  }

  private activeWindow(key: string, now: number): FailureWindow | undefined {
    const window = this.windows.get(key);
    if (!window) return undefined;
    if (window.expiresAt > now) return window;
    this.windows.delete(key);
    return undefined;
  }

  private pruneExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) this.windows.delete(key);
    }
  }
}

type AuthRateLimitEnvironment = {
  [name: string]: string | undefined;
  EDUCANVAS_DEPLOYMENT_ENV?: string;
  EDUCANVAS_AUTH_RATE_LIMIT_MODE?: string;
  NODE_ENV?: string;
};

function usesLocalLimiter(environment: AuthRateLimitEnvironment): boolean {
  const deployment = environment.EDUCANVAS_DEPLOYMENT_ENV?.trim();
  if (deployment) {
    return (
      deployment === 'local' ||
      deployment === 'test' ||
      deployment === 'development'
    );
  }
  return environment.NODE_ENV?.trim() !== 'production';
}

/** 判断当前部署能否诚实提供认证限流边界。 */
export function authRateLimitDeploymentReady(
  environment: AuthRateLimitEnvironment = process.env,
): boolean {
  if (usesLocalLimiter(environment)) return true;
  return (
    environment.EDUCANVAS_AUTH_RATE_LIMIT_MODE?.trim() === SHARED_UPSTREAM_MODE
  );
}

const localLimiter = new LocalAuthAttemptLimiter();

/** 检查本地失败窗口；共享上游模式由部署层统一裁决。 */
export function checkAuthAttempt(
  key: string,
  environment: AuthRateLimitEnvironment = process.env,
  now = Date.now(),
): AuthAttemptDecision {
  return usesLocalLimiter(environment)
    ? localLimiter.check(key, now)
    : { allowed: true };
}

/** 记录本地认证失败，并返回是否应立刻限流。 */
export function recordAuthFailure(
  key: string,
  environment: AuthRateLimitEnvironment = process.env,
  now = Date.now(),
): AuthAttemptDecision {
  return usesLocalLimiter(environment)
    ? localLimiter.fail(key, now)
    : { allowed: true };
}

/** 成功认证后重置本地主体的失败窗口。 */
export function resetAuthFailures(
  key: string,
  environment: AuthRateLimitEnvironment = process.env,
): void {
  if (usesLocalLimiter(environment)) localLimiter.succeed(key);
}
