import { z } from 'zod';

/** 只保存产品需要的年龄段，不收集出生日期或根据生物特征推断年龄。 */
export const learnerAgeBands = [
  'under_13',
  '13_to_15',
  '16_to_17',
  'adult',
  'unknown',
] as const;

export const learnerAgeBandSchema = z.enum(learnerAgeBands);
export type LearnerAgeBand = z.infer<typeof learnerAgeBandSchema>;

/** P1 课程目录使用的三个稳定年级段；具体年级后续可作为课程元数据扩展。 */
export const learnerGradeBands = [
  'primary_school',
  'middle_school',
  'high_school',
] as const;

export const learnerGradeBandSchema = z.enum(learnerGradeBands);
export type LearnerGradeBand = z.infer<typeof learnerGradeBandSchema>;

/** 年龄与年级事实只能来自明确声明，模型观察不能进入这个来源闭集。 */
export const learnerDeclarationSources = [
  'self_declared',
  'guardian_declared',
  'school_asserted',
] as const;

export const learnerDeclarationSourceSchema = z.enum(learnerDeclarationSources);
export type LearnerDeclarationSource = z.infer<
  typeof learnerDeclarationSourceSchema
>;

/**
 * 教学偏好只描述可以被学生验证和修改的交互方式，不保存人格、心理或能力标签。
 * 每个维度使用小型闭集，避免自由文本画像进入 Prompt 或数据库后无限增长。
 */
export const teachingPreferencesSchema = z
  .object({
    explanationOrder: z.enum(['example_first', 'concept_first']),
    responseDepth: z.enum(['concise', 'balanced', 'detailed']),
    guidance: z.enum(['step_by_step', 'independent_first']),
    modality: z.enum(['visual', 'text', 'practice', 'mixed']),
    feedbackStyle: z.enum(['gentle', 'direct', 'balanced']),
  })
  .strict();

export type TeachingPreferences = z.infer<typeof teachingPreferencesSchema>;

/** P1 默认值保持中性，只有用户明确选择后才偏向某种教学表达。 */
export const defaultTeachingPreferences: Readonly<TeachingPreferences> =
  Object.freeze({
    explanationOrder: 'example_first',
    responseDepth: 'balanced',
    guidance: 'step_by_step',
    modality: 'mixed',
    feedbackStyle: 'balanced',
  });

/** 创建或修订学习者画像时允许进入领域层的最小声明。 */
export const learnerProfileDeclarationSchema = z
  .object({
    ageBand: learnerAgeBandSchema,
    gradeBand: learnerGradeBandSchema,
    declarationSource: learnerDeclarationSourceSchema,
    preferences: teachingPreferencesSchema.default(defaultTeachingPreferences),
  })
  .strict();

export type LearnerProfileDeclaration = z.infer<
  typeof learnerProfileDeclarationSchema
>;

export interface LearnerAdaptationPolicy {
  ageBand: LearnerAgeBand;
  gradeBand: LearnerGradeBand;
  minorSafetyRequired: boolean;
  preferences: TeachingPreferences;
}

/** Prompt 只接受由可信画像解析出的有限参数，不能携带自由文本人格标签。 */
export const learnerAdaptationPolicySchema = z
  .object({
    ageBand: learnerAgeBandSchema,
    gradeBand: learnerGradeBandSchema,
    minorSafetyRequired: z.boolean(),
    preferences: teachingPreferencesSchema,
  })
  .strict();

/**
 * 把可信声明解析成模型可消费的有限教学参数。
 * 未知年龄必须使用更保守的未成年人策略；偏好只能改变表达，不能放宽能力或安全权限。
 */
export function resolveLearnerAdaptationPolicy(
  input: LearnerProfileDeclaration,
): LearnerAdaptationPolicy {
  const profile = learnerProfileDeclarationSchema.parse(input);
  return learnerAdaptationPolicySchema.parse({
    ageBand: profile.ageBand,
    gradeBand: profile.gradeBand,
    minorSafetyRequired: profile.ageBand !== 'adult',
    preferences: profile.preferences,
  });
}
