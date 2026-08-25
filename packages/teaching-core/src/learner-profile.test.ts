import { describe, expect, it } from 'vitest';
import {
  defaultTeachingPreferences,
  getDefaultTeachingPreferencesForGradeBand,
  learnerProfileDeclarationSchema,
  resolveLearnerAdaptationPolicy,
} from './learner-profile';

describe('学习者画像信任边界', () => {
  it('未知年龄默认采用未成年人安全策略', () => {
    const policy = resolveLearnerAdaptationPolicy({
      ageBand: 'unknown',
      gradeBand: 'middle_school',
      declarationSource: 'self_declared',
      preferences: defaultTeachingPreferences,
    });

    expect(policy.minorSafetyRequired).toBe(true);
  });

  it('成年声明仍不能通过自由文本扩展画像字段', () => {
    const result = learnerProfileDeclarationSchema.safeParse({
      ageBand: 'adult',
      gradeBand: 'high_school',
      declarationSource: 'self_declared',
      preferences: defaultTeachingPreferences,
      inferredPersonality: 'introvert',
    });

    expect(result.success).toBe(false);
  });

  it('拒绝把模型观察伪装成可信年龄来源', () => {
    const result = learnerProfileDeclarationSchema.safeParse({
      ageBand: '13_to_15',
      gradeBand: 'middle_school',
      declarationSource: 'model_inferred',
      preferences: defaultTeachingPreferences,
    });

    expect(result.success).toBe(false);
  });

  it('为四个学段提供可修改的教学偏好默认值', () => {
    expect(getDefaultTeachingPreferencesForGradeBand('primary_low')).toEqual({
      explanationOrder: 'example_first',
      responseDepth: 'concise',
      guidance: 'step_by_step',
      modality: 'visual',
      feedbackStyle: 'gentle',
    });
    expect(getDefaultTeachingPreferencesForGradeBand('primary_high')).toEqual({
      explanationOrder: 'example_first',
      responseDepth: 'balanced',
      guidance: 'step_by_step',
      modality: 'mixed',
      feedbackStyle: 'gentle',
    });
    expect(getDefaultTeachingPreferencesForGradeBand('high_school')).toEqual({
      explanationOrder: 'concept_first',
      responseDepth: 'detailed',
      guidance: 'independent_first',
      modality: 'practice',
      feedbackStyle: 'balanced',
    });
  });
});
