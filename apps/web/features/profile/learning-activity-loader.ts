import { learningActivityResponseSchema } from './activity-contract';
import type { LearningActivity } from './activity-contract';

/**
 * 档案 Activity 加载的有限状态：loading / ready / empty / failed。
 * 只向 UI 返回安全固定错误信息，不含 Response body、Error stack 或内部 code。
 */
export type ActivityLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; activity: LearningActivity }
  | { kind: 'empty' }
  | { kind: 'failed'; message: string };

const FAILED_MESSAGE = '暂时无法加载学习活动';

/**
 * 获取当前学习主体的档案活动。
 * - 固定请求 GET /api/v1/me/activity，cache: no-store
 * - 接受 AbortSignal，组件卸载后取消
 * - 用 learningActivityResponseSchema 校验成功响应
 * - activeDays=0 算 empty，不算 failed
 * - 非 2xx / JSON 解析 / schema 失败 / 网络失败 → failed
 * - Abort 不覆盖新请求结果，也不显示 failed
 * - retry 由调用方显式触发，loader 不做自动重试
 */
export async function fetchLearningActivity(
  signal: AbortSignal,
): Promise<ActivityLoadState> {
  try {
    const response = await fetch('/api/v1/me/activity', {
      cache: 'no-store',
      signal,
    });

    // Abort 后不再处理结果
    if (signal.aborted) return { kind: 'loading' };

    if (!response.ok) {
      return { kind: 'failed', message: FAILED_MESSAGE };
    }

    // JSON 解析失败
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'failed', message: FAILED_MESSAGE };
    }

    // Abort 后不再处理结果
    if (signal.aborted) return { kind: 'loading' };

    // Schema 校验
    const parsed = learningActivityResponseSchema.safeParse(body);
    if (!parsed.success) {
      return { kind: 'failed', message: FAILED_MESSAGE };
    }

    const { activity } = parsed.data;
    // activeDays=0 是 empty，不是 ready
    if (activity.activeDays === 0) {
      return { kind: 'empty' };
    }

    return { kind: 'ready', activity };
  } catch (error: unknown) {
    // AbortError → 不显示失败
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { kind: 'loading' };
    }
    // 网络/其他错误 → 返回安全固定文案
    return { kind: 'failed', message: FAILED_MESSAGE };
  }
}
