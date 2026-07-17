import { describe, expect, it } from 'vitest';
import {
  calculateMastery,
  defaultMasteryConfig,
  decideAssessmentExit,
  getReviewIntervalDays,
  type MasteryInput,
} from './mastery';

const baseInput: MasteryInput = {
  previousScore: 0,
  attemptCount: 0,
  correctCount: 0,
  hintCount: 0,
  activeMisconceptionCount: 0,
  daysSincePracticed: 0,
  prerequisiteScores: [],
};

describe('掌握度公式', () => {
  it('冷启动成功率使用Beta(1,1)平滑', () => {
    const result = calculateMastery(baseInput);
    expect(result.successRate).toBe(0.5);
    expect(result.score).toBeCloseTo(0.325, 6);
  });

  it('更多正确证据提高分数，更多提示降低分数', () => {
    const independent = calculateMastery({
      ...baseInput,
      previousScore: 0.5,
      attemptCount: 10,
      correctCount: 9,
    });
    const incorrect = calculateMastery({
      ...baseInput,
      previousScore: 0.5,
      attemptCount: 10,
      correctCount: 4,
    });
    const hinted = calculateMastery({
      ...baseInput,
      previousScore: 0.5,
      attemptCount: 10,
      correctCount: 9,
      hintCount: 8,
    });

    expect(independent.score).toBeGreaterThan(incorrect.score);
    expect(hinted.score).toBeLessThan(independent.score);
  });

  it('先修薄弱时对下游掌握度封顶', () => {
    const result = calculateMastery({
      ...baseInput,
      previousScore: 1,
      attemptCount: 100,
      correctCount: 100,
      prerequisiteScores: [0],
    });

    expect(result.prerequisiteCap).toBe(0.85);
    expect(result.score).toBeLessThanOrEqual(0.85);
  });

  it('拒绝不可能的计数', () => {
    expect(() =>
      calculateMastery({ ...baseInput, attemptCount: 1, correctCount: 2 }),
    ).toThrow();
  });

  it('拒绝非法权重与反转的滞后阈值', () => {
    expect(() =>
      calculateMastery(baseInput, {
        ...defaultMasteryConfig,
        evidenceWeight: 0.7,
      }),
    ).toThrow();
    expect(() =>
      calculateMastery(baseInput, {
        ...defaultMasteryConfig,
        exitThreshold: 0.9,
      }),
    ).toThrow();
  });
});

describe('ASSESS出口与复习调度', () => {
  it('未掌握学生满足全部门槛才ADVANCE', () => {
    expect(
      decideAssessmentExit({
        score: 0.9,
        previouslyMastered: false,
        prerequisiteScores: [0.85],
        recentAttemptCount: 5,
        recentCorrectCount: 4,
        hasActiveSevereMisconception: false,
      }).decision,
    ).toBe('ADVANCE');

    expect(
      decideAssessmentExit({
        score: 0.9,
        previouslyMastered: false,
        prerequisiteScores: [0.85],
        recentAttemptCount: 2,
        recentCorrectCount: 2,
        hasActiveSevereMisconception: false,
      }),
    ).toMatchObject({
      decision: 'REMEDIATE',
      reasons: ['INSUFFICIENT_RECENT_ATTEMPTS'],
    });
  });

  it('滞后区间避免已掌握学生因单次波动退出', () => {
    expect(
      decideAssessmentExit({
        score: 0.8,
        previouslyMastered: true,
        prerequisiteScores: [],
        recentAttemptCount: 1,
        recentCorrectCount: 0,
        hasActiveSevereMisconception: false,
      }).decision,
    ).toBe('ADVANCE');
  });

  it('严重误区强制补救', () => {
    expect(
      decideAssessmentExit({
        score: 0.95,
        previouslyMastered: true,
        prerequisiteScores: [1],
        recentAttemptCount: 5,
        recentCorrectCount: 5,
        hasActiveSevereMisconception: true,
      }),
    ).toMatchObject({
      decision: 'REMEDIATE',
      reasons: ['ACTIVE_SEVERE_MISCONCEPTION'],
    });
  });

  it('拒绝不可能的近期测评计数', () => {
    expect(() =>
      decideAssessmentExit({
        score: 0.9,
        previouslyMastered: false,
        prerequisiteScores: [],
        recentAttemptCount: 1,
        recentCorrectCount: 2,
        hasActiveSevereMisconception: false,
      }),
    ).toThrow();
  });

  it('复习调度与掌握判断分离并按误区减半', () => {
    expect(getReviewIntervalDays(0.4, 0)).toBe(1);
    expect(getReviewIntervalDays(0.7, 0)).toBe(7);
    expect(getReviewIntervalDays(0.95, 0)).toBe(30);
    expect(getReviewIntervalDays(0.7, 2)).toBe(3.5);
  });

  it('复习调度拒绝非有限分数', () => {
    expect(() => getReviewIntervalDays(Number.NaN, 0)).toThrow();
  });
});
