import { describe, expect, it, vi, afterEach } from 'vitest';
import type { LearningActivity } from './activity-contract';
import { fetchLearningActivity } from './learning-activity-loader';

function activityJson(activeDays: number): { activity: LearningActivity } {
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

  it('有历史 session 或掌握度时，activeDays=0 仍如实返回 ready', async () => {
    const body = activityJson(0);
    body.activity.totalSessions = 4;
    body.activity.masteryPercent = 72;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const state = await fetchLearningActivity(new AbortController().signal);
    expect(state).toMatchObject({ kind: 'ready' });
    if (state.kind === 'ready') {
      expect(state.activity.totalSessions).toBe(4);
      expect(state.activity.masteryPercent).toBe(72);
    }
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

  it('后发请求隔离：已 abort 的旧请求即使晚到也不产生可提交状态', async () => {
    let resolveOldResponse: ((response: Response) => void) | undefined;
    let resolveNewResponse: ((response: Response) => void) | undefined;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOldResponse = resolve;
    });
    const newResponse = new Promise<Response>((resolve) => {
      resolveNewResponse = resolve;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => oldResponse)
      .mockImplementationOnce(() => newResponse);

    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const oldRequest = fetchLearningActivity(controller1.signal);
    controller1.abort();
    const newRequest = fetchLearningActivity(controller2.signal);

    resolveNewResponse!(
      new Response(JSON.stringify(activityJson(10)), { status: 200 }),
    );
    const state2 = await newRequest;
    expect(state2.kind).toBe('ready');
    if (state2.kind === 'ready') {
      expect(state2.activity.activeDays).toBe(10);
    }

    // 模拟 fetch 无视 abort 而迟到返回；loader 必须拒绝它，不能让旧值覆盖新值。
    resolveOldResponse!(
      new Response(JSON.stringify(activityJson(1)), { status: 200 }),
    );
    await expect(oldRequest).resolves.toEqual({ kind: 'loading' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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
