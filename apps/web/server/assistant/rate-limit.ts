import 'server-only';

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_RATE_WINDOWS = 10_000;

type RateWindow = { count: number; resetAt: number };

const rateWindows = new Map<string, RateWindow>();

/**
 * 小助手端点的每主体滑动窗口限流（默认 10 次 / 60 秒）。
 * 每个请求都会触发一次 LLM 意图分类，限流是成本与滥用防线。
 * 仅供 local/development/test 使用的单进程窗口；非本地部署需在网关层
 * 叠加共享限流，本实现不作为跨实例安全边界（与 auth/rate-limit 同约定）。
 */
export type AssistantRateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterMs: number };

export function checkAssistantRateLimit(
  key: string,
  now = Date.now(),
): AssistantRateLimitDecision {
  const w = rateWindows.get(key);
  if (!w || w.resetAt <= now) {
    // 过期窗口清理 + 容量保护，避免无界增长。
    if (!w && rateWindows.size >= MAX_RATE_WINDOWS) {
      for (const [k, v] of rateWindows) {
        if (v.resetAt <= now) rateWindows.delete(k);
      }
      if (rateWindows.size >= MAX_RATE_WINDOWS) {
        const oldest = rateWindows.keys().next().value;
        if (oldest !== undefined) rateWindows.delete(oldest);
      }
    }
    rateWindows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (w.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: Math.max(1, w.resetAt - now) };
  }
  w.count += 1;
  return { allowed: true };
}

/** 仅供测试使用：清空限流窗口，避免跨用例互相干扰。 */
export function resetAssistantRateLimit(): void {
  rateWindows.clear();
}
