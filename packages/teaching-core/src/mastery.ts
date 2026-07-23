/**
 * 掌握度计算 — K12 教学的核心量化模型。
 *
 * ## 设计目标
 *
 * 掌握度不是简单的"正确率"，而是一个**多维加权评分**：
 * - 成功/失败（Beta(1,1) 先验冷启动）
 * - 时间衰减（久未练习 → 分数降低）
 * - 提示惩罚（频繁求助 → 分数降低）
 * - 误区惩罚（活跃误区 → 分数降低）
 * - 先修上限（前驱知识未掌握 → 当前分数被 cap）
 *
 * ## 公式（ADR-0005 确认）
 *
 * ```
 * score = previousWeight × recencyAdjustedPrevious + evidenceWeight × evidence
 * evidence = successRate × hintFactor × misconceptionFactor
 * score = clamp(score, 0, prerequisiteCap)
 * ```
 *
 * ## 滞后阈值（Hysteresis）
 *
 * enterThreshold (0.85) > exitThreshold (0.75) — 防止分数在边界反复弹跳。
 * 进入需要更高门槛，退出需要更低门槛，形成"已掌握"的稳定性。
 *
 * ## 策略快照
 *
 * 所有算法参数打包为 `MasteryConfig`，事件保存当时的配置快照，
 * 确保历史掌握度可以**确定性回放** — 不会因为后续参数调优改变历史计算结果。
 */

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

/** 默认掌握度策略的稳定版本；事件同时保存完整参数以支持确定性历史回放。 */
export const DEFAULT_MASTERY_POLICY_VERSION = 'mastery-v1' as const;

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
  /**
   * v1 掌握度公式 — 分步说明：
   *
   * 1. recencyDecay = e^(-rate × days) — 指数衰减，越久越降
   * 2. successRate = (correct+1)/(attempts+2) — Beta(1,1) 先验冷启动，
   *    +1/+2 相当于假设"已经有过一次虚拟正确和一次虚拟错误"，
   *    避免 1/1=100% 或 0/1=0% 的极端值
   * 3. hintFactor = 1 - rate × hints/attempts — 频繁提示降低分数
   * 4. misconceptionFactor = 1 - rate × activeMiscCount — 活跃误区越多越降
   * 5. prerequisiteCap — 最弱先修决定上限，用 min() 而非 mean()：
   *    避免其他高分先修掩盖关键知识缺口（比如除法很好但乘法很差）
   * 6. score = clamp(prevWeight × old + evidWeight × new, 0, prerequisiteCap)
   */
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

/** ASSESS出口决策的稳定解释码闭集，可直接用于日志和教师侧解释。 */
export const assessmentReasons = [
  'MASTERY_CONFIRMED',
  'MASTERY_BELOW_ENTER_THRESHOLD',
  'MASTERY_BELOW_EXIT_THRESHOLD',
  'PREREQUISITE_BELOW_GATE',
  'INSUFFICIENT_RECENT_ATTEMPTS',
  'RECENT_ACCURACY_BELOW_THRESHOLD',
  'ACTIVE_SEVERE_MISCONCEPTION',
] as const;

export const assessmentReasonSchema = z.enum(assessmentReasons);
export type AssessmentReason = z.infer<typeof assessmentReasonSchema>;

/** ASSESS出口决策及其全部证据原因。 */
export interface AssessmentExit {
  decision: 'REMEDIATE' | 'ADVANCE';
  reasons: readonly AssessmentReason[];
  recentAccuracy: number;
}

/**
 * 使用滞后阈值、先修门槛和近期证据确定 ASSESS 出口。
 *
 * ## 双分支设计
 *
 * 学生分两种情况，检查标准不同：
 *
 * ### 分支 1：已掌握过 (`previouslyMastered=true`)
 * 用 **exitThreshold**（较低，默认 0.75）判断是否需要退回。
 * 宽松标准 — 曾经掌握的知识只需不低于退出线就放行。
 * 只检查两项：分数低于退出阈值 + 严重活跃误区。
 *
 * ### 分支 2：首次掌握 (`previouslyMastered=false`)
 * 用 **enterThreshold**（较高，默认 0.85）判断是否达到掌握。
 * 严格标准 — 必须跨过进入门槛才算"学会了"。
 * 检查五项：分数/先修门槛/近期作答量/近期正确率/严重误区。
 *
 * 任何一项不满足 → REMEDIATE；全部满足 → ADVANCE。
 */
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

  // 分支 1：已掌握过的学生 — 只检查是否掉出 exitThreshold
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

  // 分支 2：首次掌握 — 全量检查五维条件
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

/**
 * 返回独立复习调度器的间隔天数 — 不参与是否掌握的判断。
 *
 * ## v1 分桶策略
 *
 * 根据掌握度分数分桶，间隔从 1 天到 30 天不等。
 * 有 >= 2 个活跃误区时，间隔减半（不低于 1 天）。
 *
 * | 分数范围 | 复习间隔 | 含义 |
 * |---------|---------|------|
 * | < 0.45 | 1 天 | 薄弱 — 明天就复习 |
 * | < 0.65 | 3 天 | 一般 |
 * | < 0.80 | 7 天 | 不错 |
 * | < 0.90 | 14 天 | 好 |
 * | >= 0.90 | 30 天 | 扎实 |
 *
 * 这是可校准的教学策略，不是掌握度公式推导出的固定常数。
 * 后续版本可能改为更细粒度的间隔算法。
 */
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

  // v1分桶是可校准教学策略，不是由掌握度公式推导出的固定常数。
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
