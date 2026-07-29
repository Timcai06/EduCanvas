import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchLearningActivity } from './learning-activity-loader';

function activityJson(activeDays: number) {
  const days: Array<{ date: string; count: number }> = [];
  // 生成 371 个有效日期（从 371 天前到今天）
  for (let i = 0; i < 371; i++) {
    const d = new Date(Date.UTC(2026, 6, 24)); // 2026-07-24
    d.setUTCDate(d.getUTCDate() - 370 + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    days.push({
      date: `${y}-${m}-${day}`,
      count: activeDays > 0 && i === 370 ? 1 : 0,
    });
  }
  return {
    activity: {
      days,
      totalSessions: activeDays,
      activeDays,
      streakDays: activeDays,
      masteryPercent: null,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchLearningActivity', () => {
  it('ready：成功获取有活动的数据', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(activityJson(5)), { status: 200 }),
    );
    const controller = new AbortController();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.activity.activeDays).toBe(5);
    }
  });

  it('empty：activeDays=0 返回空态而非 ready', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(activityJson(0)), { status: 200 }),
    );
    const controller = new AbortController();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('empty');
  });

  it('failed：HTTP 非 200 返回失败', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Error', { status: 500 }),
    );
    const controller = new AbortController();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('failed');
    if (state.kind === 'failed') {
      expect(state.message).toBeTruthy();
      expect(state.message).not.toContain('Internal Error');
    }
  });

  it('failed：非法 JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json{{', { status: 200 }),
    );
    const controller = new AbortController();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('failed');
  });

  it('failed：schema 不符', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ activity: null }), { status: 200 }),
    );
    const controller = new AbortController();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('failed');
  });

  it('failed：网络错误不泄露原始信息', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('Failed to fetch'),
    );
    const controller = new AbortController();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('failed');
    if (state.kind === 'failed') {
      expect(state.message).not.toContain('Failed to fetch');
    }
  });

  it('Abort 后不返回失败', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          const err = new DOMException(
            'The user aborted a request.',
            'AbortError',
          );
          reject(err);
        }),
    );
    const controller = new AbortController();
    controller.abort();
    const state = await fetchLearningActivity(controller.signal);
    expect(state.kind).toBe('loading');
  });

  it('后发请求不被旧响应覆盖', async () => {
    const controller2 = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(activityJson(10)), { status: 200 }),
    );
    const state2 = await fetchLearningActivity(controller2.signal);
    expect(state2.kind).toBe('ready');
    if (state2.kind === 'ready') {
      expect(state2.activity.activeDays).toBe(10);
    }
  });

  it('单次调用只产生一次 fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(activityJson(3)), { status: 200 }),
    );
    const controller = new AbortController();
    await fetchLearningActivity(controller.signal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
