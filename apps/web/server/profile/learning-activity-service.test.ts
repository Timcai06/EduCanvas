import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockGetForStudent } = vi.hoisted(() => ({
  mockGetForStudent: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  DrizzleLearningActivityRepository: function () {
    return { getForStudent: mockGetForStudent };
  },
}));

import { getLearningActivity } from './learning-activity-service';

const NOW = new Date('2026-07-24T09:00:00+08:00');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLearningActivity', () => {
  it('trustedStudentId 为 null 时不访问 Repository，返回真实空投影', async () => {
    const result = await getLearningActivity(null, NOW);
    expect(mockGetForStudent).not.toHaveBeenCalled();
    expect(result.activeDays).toBe(0);
    expect(result.streakDays).toBe(0);
    expect(result.totalSessions).toBe(0);
    expect(result.masteryPercent).toBeNull();
  });

  it('有主体时调用 Repository 并传递可信 facts 给日期派生', async () => {
    mockGetForStudent.mockResolvedValueOnce({
      gradedActivityAt: [
        '2026-07-24T01:00:00+08:00',
        '2026-07-24T02:00:00+08:00',
        '2026-07-23T10:00:00+08:00',
      ],
      meanMasteryScore: 0.75,
      totalSessions: 5,
    });
    const result = await getLearningActivity('student-123', NOW);
    expect(mockGetForStudent).toHaveBeenCalledWith('student-123');
    expect(result.activeDays).toBe(2);
    expect(result.totalSessions).toBe(5);
  });

  it('mastery 为 null 时返回 null，不自行推断', async () => {
    mockGetForStudent.mockResolvedValueOnce({
      gradedActivityAt: [],
      meanMasteryScore: null,
      totalSessions: 0,
    });
    const result = await getLearningActivity('student-123', NOW);
    expect(result.masteryPercent).toBeNull();
  });

  it('mastery 四舍五入转百分比', async () => {
    mockGetForStudent.mockResolvedValueOnce({
      gradedActivityAt: [],
      meanMasteryScore: 0.756,
      totalSessions: 0,
    });
    const result = await getLearningActivity('student-123', NOW);
    expect(result.masteryPercent).toBe(76);
  });

  it('Repository 失败不被伪装成空活动', async () => {
    mockGetForStudent.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(getLearningActivity('student-123', NOW)).rejects.toThrow();
  });
});
