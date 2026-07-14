import { z } from 'zod';

/** K12人工智能通识课v1允许驱动补救策略的封闭误区标签集。 */
export const misconceptionTags = [
  'ANTHROPOMORPHISM',
  'PROGRAMMED_BEHAVIOR_ONLY',
  'AI_IS_EXACT_OR_CERTAIN',
  'TRAINS_DURING_USE',
  'USER_TRAINS_MODEL_NOW',
  'STORES_RAW_EXAMPLES',
  'AUTONOMOUS_DATA_ACQUISITION',
  'CONFUSES_MODEL_WITH_DATA',
  'FEATURE_IS_SINGLE_OBVIOUS_TRAIT',
  'MEMORIZATION_EQUALS_GENERALIZATION',
  'MORE_DATA_ALWAYS_FIXES_ERRORS',
  'CORRELATION_EQUALS_REASON',
  'ONE_METRIC_IS_ENOUGH',
] as const;

export const misconceptionTagSchema = z.enum(misconceptionTags);
/** 封闭核心误区标签类型；候选新标签不能直接进入此联合。 */
export type MisconceptionTag = z.infer<typeof misconceptionTagSchema>;

/** 掌握度配置的运行时边界，保证权重、滞后阈值和各项比例语义成立。 */
export const masteryConfigSchema = z
  .object({
    recencyDecayRate: z.number().nonnegative(),
    previousWeight: z.number().min(0).max(1),
    evidenceWeight: z.number().min(0).max(1),
    hintPenaltyRate: z.number().nonnegative(),
    hintFactorFloor: z.number().min(0).max(1),
    misconceptionPenaltyRate: z.number().nonnegative(),
    misconceptionFactorFloor: z.number().min(0).max(1),
    prerequisiteBaseCap: z.number().min(0).max(1),
    prerequisiteWeight: z.number().min(0).max(1),
    enterThreshold: z.number().min(0).max(1),
    exitThreshold: z.number().min(0).max(1),
    prerequisiteGate: z.number().min(0).max(1),
    recentMinimumAttempts: z.number().int().positive(),
    recentMinimumAccuracy: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((config, context) => {
    if (Math.abs(config.previousWeight + config.evidenceWeight - 1) > 1e-9) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceWeight'],
        message: 'previousWeight与evidenceWeight之和必须为1',
      });
    }
    if (config.exitThreshold >= config.enterThreshold) {
      context.addIssue({
        code: 'custom',
        path: ['exitThreshold'],
        message: 'exitThreshold必须小于enterThreshold以形成滞后区间',
      });
    }
  });

/** 掌握度v1的可校准参数，业务代码不得散落同名数字。 */
export type MasteryConfig = z.infer<typeof masteryConfigSchema>;

/** ADR-0005确认的初始默认值；试点后通过配置整体替换。 */
export const defaultMasteryConfig: Readonly<MasteryConfig> = Object.freeze(
  masteryConfigSchema.parse({
    recencyDecayRate: 0.035,
    previousWeight: 0.35,
    evidenceWeight: 0.65,
    hintPenaltyRate: 0.15,
    hintFactorFloor: 0.7,
    misconceptionPenaltyRate: 0.05,
    misconceptionFactorFloor: 0.7,
    prerequisiteBaseCap: 0.85,
    prerequisiteWeight: 0.15,
    enterThreshold: 0.85,
    exitThreshold: 0.75,
    prerequisiteGate: 0.8,
    recentMinimumAttempts: 3,
    recentMinimumAccuracy: 0.8,
  }),
);

/** 掌握度公式输入的运行时边界，拒绝不可能的计数和越界分数。 */
export const masteryInputSchema = z
  .object({
    previousScore: z.number().min(0).max(1),
    attemptCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    hintCount: z.number().int().nonnegative(),
    activeMisconceptionCount: z.number().int().nonnegative(),
    daysSincePracticed: z.number().nonnegative(),
    prerequisiteScores: z.array(z.number().min(0).max(1)),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.correctCount > input.attemptCount) {
      context.addIssue({
        code: 'custom',
        path: ['correctCount'],
        message: 'correctCount不能大于attemptCount',
      });
    }
  });

/** 通过运行时Schema校验的掌握度公式输入。 */
export type MasteryInput = z.infer<typeof masteryInputSchema>;

/** 可直接向教师、家长和评测日志解释的掌握度计算分解。 */
export interface MasteryCalculation {
  score: number;
  recencyDecay: number;
  recencyAdjustedPrevious: number;
  successRate: number;
  hintFactor: number;
  misconceptionFactor: number;
  prerequisiteCap: number;
  evidence: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/** 根据ADR-0005的确定性公式计算掌握度及全部解释因子。 */
export function calculateMastery(
  rawInput: MasteryInput,
  config: Readonly<MasteryConfig> = defaultMasteryConfig,
): MasteryCalculation {
  const input = masteryInputSchema.parse(rawInput);
  const parsedConfig = masteryConfigSchema.parse(config);
  const recencyDecay = Math.exp(
    -parsedConfig.recencyDecayRate * input.daysSincePracticed,
  );
  const recencyAdjustedPrevious = input.previousScore * recencyDecay;
  const successRate = (input.correctCount + 1) / (input.attemptCount + 2);
  const hintFactor = Math.max(
    parsedConfig.hintFactorFloor,
    1 -
      (parsedConfig.hintPenaltyRate * input.hintCount) /
        Math.max(input.attemptCount, 1),
  );
  const misconceptionFactor = Math.max(
    parsedConfig.misconceptionFactorFloor,
    1 - parsedConfig.misconceptionPenaltyRate * input.activeMisconceptionCount,
  );
  const prerequisiteCap =
    input.prerequisiteScores.length === 0
      ? 1
      : Math.min(
          1,
          parsedConfig.prerequisiteBaseCap +
            parsedConfig.prerequisiteWeight *
              Math.min(...input.prerequisiteScores),
        );
  const evidence = successRate * hintFactor * misconceptionFactor;
  const score = clamp(
    parsedConfig.previousWeight * recencyAdjustedPrevious +
      parsedConfig.evidenceWeight * evidence,
    0,
    prerequisiteCap,
  );

  return {
    score,
    recencyDecay,
    recencyAdjustedPrevious,
    successRate,
    hintFactor,
    misconceptionFactor,
    prerequisiteCap,
    evidence,
  };
}

/** ASSESS出口证据的运行时边界，保证近期正确数不超过作答数。 */
export const assessmentEvidenceSchema = z
  .object({
    score: z.number().min(0).max(1),
    previouslyMastered: z.boolean(),
    prerequisiteScores: z.array(z.number().min(0).max(1)),
    recentAttemptCount: z.number().int().nonnegative(),
    recentCorrectCount: z.number().int().nonnegative(),
    hasActiveSevereMisconception: z.boolean(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.recentCorrectCount > evidence.recentAttemptCount) {
      context.addIssue({
        code: 'custom',
        path: ['recentCorrectCount'],
        message: 'recentCorrectCount不能大于recentAttemptCount',
      });
    }
  });

/** 通过运行时Schema约束的ASSESS证据。 */
export type AssessmentEvidence = z.infer<typeof assessmentEvidenceSchema>;

/** ASSESS出口决策的稳定解释码，可直接用于日志和教师侧解释。 */
export type AssessmentReason =
  | 'MASTERY_CONFIRMED'
  | 'MASTERY_BELOW_ENTER_THRESHOLD'
  | 'MASTERY_BELOW_EXIT_THRESHOLD'
  | 'PREREQUISITE_BELOW_GATE'
  | 'INSUFFICIENT_RECENT_ATTEMPTS'
  | 'RECENT_ACCURACY_BELOW_THRESHOLD'
  | 'ACTIVE_SEVERE_MISCONCEPTION';

/** ASSESS出口决策及其全部证据原因。 */
export interface AssessmentExit {
  decision: 'REMEDIATE' | 'ADVANCE';
  reasons: readonly AssessmentReason[];
  recentAccuracy: number;
}

/** 使用滞后阈值、先修门槛和近期证据确定ASSESS出口。 */
export function decideAssessmentExit(
  rawEvidence: AssessmentEvidence,
  config: Readonly<MasteryConfig> = defaultMasteryConfig,
): AssessmentExit {
  const evidence = assessmentEvidenceSchema.parse(rawEvidence);
  const parsedConfig = masteryConfigSchema.parse(config);
  const recentAccuracy =
    evidence.recentAttemptCount === 0
      ? 0
      : evidence.recentCorrectCount / evidence.recentAttemptCount;

  if (evidence.previouslyMastered) {
    const reasons: AssessmentReason[] = [];
    if (evidence.score < parsedConfig.exitThreshold)
      reasons.push('MASTERY_BELOW_EXIT_THRESHOLD');
    if (evidence.hasActiveSevereMisconception)
      reasons.push('ACTIVE_SEVERE_MISCONCEPTION');
    return reasons.length > 0
      ? { decision: 'REMEDIATE', reasons, recentAccuracy }
      : { decision: 'ADVANCE', reasons: ['MASTERY_CONFIRMED'], recentAccuracy };
  }

  const reasons: AssessmentReason[] = [];
  if (evidence.score < parsedConfig.enterThreshold)
    reasons.push('MASTERY_BELOW_ENTER_THRESHOLD');
  if (
    evidence.prerequisiteScores.some(
      (score) => score < parsedConfig.prerequisiteGate,
    )
  ) {
    reasons.push('PREREQUISITE_BELOW_GATE');
  }
  if (evidence.recentAttemptCount < parsedConfig.recentMinimumAttempts) {
    reasons.push('INSUFFICIENT_RECENT_ATTEMPTS');
  }
  if (recentAccuracy < parsedConfig.recentMinimumAccuracy) {
    reasons.push('RECENT_ACCURACY_BELOW_THRESHOLD');
  }
  if (evidence.hasActiveSevereMisconception)
    reasons.push('ACTIVE_SEVERE_MISCONCEPTION');

  return reasons.length > 0
    ? { decision: 'REMEDIATE', reasons, recentAccuracy }
    : { decision: 'ADVANCE', reasons: ['MASTERY_CONFIRMED'], recentAccuracy };
}

/** 返回独立复习调度器的间隔天数；它不参与是否掌握的判断。 */
export function getReviewIntervalDays(
  score: number,
  activeMisconceptionCount: number,
): number {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError('score必须是0到1之间的有限数');
  }
  if (
    !Number.isInteger(activeMisconceptionCount) ||
    activeMisconceptionCount < 0
  ) {
    throw new RangeError('activeMisconceptionCount必须是非负整数');
  }

  const baseInterval =
    score < 0.45
      ? 1
      : score < 0.65
        ? 3
        : score < 0.8
          ? 7
          : score < 0.9
            ? 14
            : 30;
  return activeMisconceptionCount >= 2
    ? Math.max(1, baseInterval / 2)
    : baseInterval;
}
