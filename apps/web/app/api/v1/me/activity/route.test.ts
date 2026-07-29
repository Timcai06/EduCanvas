import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockReadIdentity = vi.fn();
const mockGetActivity = vi.fn();

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: () => mockReadIdentity(),
}));

vi.mock('@/server/profile/learning-activity-service', () => ({
  getLearningActivity: (...args: unknown[]) => mockGetActivity(...args),
}));

import { GET } from './route';

function emptyActivity() {
  return {
    days: Array.from({ length: 371 }, (_v, i) => {
      const d = new Date(Date.UTC(2026, 6, 24));
      d.setUTCDate(d.getUTCDate() - 370 + i);
      return {
        date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
        count: 0,
      };
    }),
    totalSessions: 0,
    activeDays: 0,
    streakDays: 0,
    masteryPercent: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/me/activity', () => {
  it('成功响应通过 schema，带 private, no-store', async () => {
    mockReadIdentity.mockResolvedValue({ studentId: 's1' });
    mockGetActivity.mockResolvedValue(emptyActivity());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toHaveProperty('activity');
    expect(body.activity.activeDays).toBe(0);
  });

  it('无身份返回 200 的真实空投影', async () => {
    mockReadIdentity.mockResolvedValue(null);
    mockGetActivity.mockResolvedValue(emptyActivity());
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity.activeDays).toBe(0);
    expect(body.activity.masteryPercent).toBeNull();
  });

  it('服务异常返回 500 activity_unavailable 和安全中文文案', async () => {
    mockReadIdentity.mockResolvedValue({ studentId: 's1' });
    mockGetActivity.mockRejectedValue(new Error('DB DOWN'));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe('activity_unavailable');
    expect(body.error?.message).toBeTruthy();
    const str = JSON.stringify(body);
    expect(str).not.toContain('DB DOWN');
    expect(str).not.toContain('stack');
  });

  it('主体只来自 readAnonymousIdentity，不接受参数指定', async () => {
    mockReadIdentity.mockResolvedValue({ studentId: 's1' });
    mockGetActivity.mockResolvedValue(emptyActivity());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockReadIdentity).toHaveBeenCalled();
    expect(mockGetActivity).toHaveBeenCalled();
    expect(mockGetActivity.mock.calls[0]?.[0]).toBe('s1');
  });

  it('契约输出异常返回 activity_contract_violation', async () => {
    mockReadIdentity.mockResolvedValue({ studentId: 's1' });
    // 返回违反 schema 的形状
    mockGetActivity.mockResolvedValue({ days: null, totalSessions: 0 });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe('activity_contract_violation');
  });

  it('错误响应不含原始异常、堆栈、主体 ID', async () => {
    mockReadIdentity.mockResolvedValue({ studentId: 'pii-student-999' });
    mockGetActivity.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );
    const res = await GET();
    const body = await res.json();
    const str = JSON.stringify(body);
    expect(str).not.toContain('ECONNREFUSED');
    expect(str).not.toContain('127.0.0.1');
    expect(str).not.toContain('5432');
    expect(str).not.toContain('pii-student-999');
    expect(str).not.toContain('stack');
  });
});
