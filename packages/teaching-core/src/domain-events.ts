/**
 * 领域事件 — 事件溯源模式的可信事实记录。
 *
 * ## 为什么用事件溯源？
 *
 * 教学场景的核心数据（状态转移、掌握度变化）必须**可审计、可回放**。
 * 直接 UPDATE 一行数据会丢失"这个分数是怎么算出来的"、"为什么从这里跳到那里"的全部上下文。
 * 事件溯源把每个事实变化记录为不可变事件，掌握度可以通过回放事件流确定性重算。
 *
 * ## 事件类型（阶段一闭集）
 *
 * | 事件 | 生产者 | 含义 |
 * |------|--------|------|
 * | state_transition | teaching_runtime | 教学状态转移（DIAGNOSE→EXPLAIN 等） |
 * | assessment_exit_decided | teaching_runtime | ASSESS 出口决策（仅 ADVANCE，REMEDIATE 走 state_transition） |
 * | assessment_graded | grading_service | 判分结果（测验/分类游戏） |
 * | hint_recorded | teaching_runtime | 学生请求了提示 |
 * | misconception_updated | misconception_service | 误区标签变更（激活/消除） |
 * | artifact_completed | teaching_runtime | 学生完成了 Canvas 交互 |
 *
 * ## Schema 版本独立演进
 *
 * 服务端事件协议版本 (`DOMAIN_EVENT_SCHEMA_VERSION`) 与客户端 Canvas 事件版本**独立**。
 * 服务端事件是持久化事实，升级需要迁移策略；客户端事件是瞬态的。
 *
 * ## 新增事件类型检查清单
 * 1. 加入 domainLearningEventTypes
 * 2. 在 discriminatedUnion 中定义 Schema
 * 3. 在 superRefine 中添加 source 校验规则
 * 4. 在 learning-projection 中添加投影逻辑
 */

import { z } from 'zod';
import {
  assessmentEvidenceSchema,
  assessmentReasonSchema,
  masteryConfigSchema,
  misconceptionTagSchema,
} from './mastery';
import {
  resolveTransitionCandidate,
  teachingStateSchema,
  teachingTransitionCandidateSignalSchema,
} from './state-machine';
import { teachingTools } from './tools';

/** 服务端可信领域事件协议版本，与客户端Canvas事件版本独立演进。 */
export const DOMAIN_EVENT_SCHEMA_VERSION = '1' as const;

/** 阶段一可写入learning_events并参与回放的领域事件闭集。 */
export const domainLearningEventTypes = [
  'state_transition',
  'assessment_exit_decided',
  'assessment_graded',
  'hint_recorded',
  'misconception_updated',
  'artifact_completed',
] as const;

/**
 * 服务端可签发事件的四个生产者。
 * `migration` 是历史数据导入的显式兼容通道 — 在线生产者必须与事件类型严格匹配，
 * 但 migration 可以写入任意事件类型以回填遗留记录。
 */
export const domainEventSources = [
  'teaching_runtime',
  'grading_service',
  'misconception_service',
  'migration',
] as const;

const eventBaseShape = {
  schemaVersion: z.literal(DOMAIN_EVENT_SCHEMA_VERSION),
  eventId: z.uuid(),
  idempotencyKey: z.string().min(1).max(128),
  studentId: z.string().min(1).max(128),
  sessionId: z.uuid(),
  knowledgeNodeId: z.string().min(1).max(128).nullable(),
  sequence: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  source: z.enum(domainEventSources),
  causationId: z.string().min(1).max(128),
};

/** ASSESS决策快照保存判定结果及其原始可信证据，不在回放时重新调用当前策略。 */
const assessmentExitSnapshotSchema = z
  .object({
    decision: z.enum(['REMEDIATE', 'ADVANCE']),
    reasons: z.array(assessmentReasonSchema).min(1),
    recentAccuracy: z.number().min(0).max(1),
    evidence: assessmentEvidenceSchema,
  })
  .strict();

const stateTransitionPayloadSchema = z
  .object({
    from: teachingStateSchema,
    to: teachingStateSchema,
    /**
     * 转移原因。历史 migration 事件可能使用自由文本；
     * 当前 runtime 通过 superRefine 跨字段校验收紧为闭集候选信号。
     */
    reason: z.string().min(1).max(300),
    triggerTool: z.enum(teachingTools).optional(),
    /** 新事件冻结课程策略与当时可见的练习事实；全部缺省仅用于旧事件兼容。 */
    policyVersion: z.string().min(1).max(64).optional(),
    minimumPracticeEvents: z.number().int().nonnegative().optional(),
    practiceEventCount: z.number().int().nonnegative().optional(),
    assessmentExit: assessmentExitSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    /**
     * 策略快照完整性校验 — 三类字段要么全填（新版事件，支持确定性回放），
     * 要么全空（旧版事件，回放时使用当前配置）。禁止半填半空，否则回放结果不确定。
     */
    const policySnapshot = [
      payload.policyVersion,
      payload.minimumPracticeEvents,
      payload.practiceEventCount,
    ];
    const presentPolicyFields = policySnapshot.filter(
      (value) => value !== undefined,
    ).length;
    if (presentPolicyFields !== 0 && presentPolicyFields !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['policyVersion'],
        message: '状态转移策略快照必须完整提供或全部缺省',
      });
    }
    /**
     * ASSESS 出口约束 — state_transition 只记录 REMEDIATE（退回重学），
     * ADVANCE 走独立的 assessment_exit_decided 事件。
     * 这保证"通过"和"不通过"有各自独立的审计轨迹。
     */
    if (payload.from === 'ASSESS') {
      if (
        payload.assessmentExit &&
        payload.assessmentExit.decision !== 'REMEDIATE'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assessmentExit', 'decision'],
          message: 'ASSESS状态转移只能记录REMEDIATE决策',
        });
      }
      if (presentPolicyFields === 3 && !payload.assessmentExit) {
        context.addIssue({
          code: 'custom',
          path: ['assessmentExit'],
          message: '新版ASSESS状态转移必须保存决策证据',
        });
      }
    } else if (payload.assessmentExit) {
      context.addIssue({
        code: 'custom',
        path: ['assessmentExit'],
        message: '只有ASSESS出口可以保存决策证据',
      });
    }
  });

const assessmentPayloadSchema = z
  .object({
    artifactId: z.string().min(1).max(128),
    assessmentType: z.enum(['quiz', 'classification_game']),
    attemptedItems: z.number().int().positive().max(100),
    correctItems: z.number().int().nonnegative().max(100),
    usedHint: z.boolean(),
    /**
     * 判分时读取的可信先修掌握度快照。旧事件可以缺省；新写入者应记录，
     * 使掌握度回放不会依赖“当前”先修分数而改写历史结果。
     */
    prerequisiteScores: z.array(z.number().min(0).max(1)).optional(),
    /** 新判分事件冻结掌握度算法版本和完整参数；二者缺省仅用于旧事件兼容。 */
    masteryPolicyVersion: z.string().min(1).max(64).optional(),
    masteryConfig: masteryConfigSchema.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.correctItems > payload.attemptedItems) {
      context.addIssue({
        code: 'custom',
        path: ['correctItems'],
        message: 'correctItems不能大于attemptedItems',
      });
    }
    /**
     * 掌握度策略快照完整性 — 版本号与参数必须同时出现或同时缺席。
     * 同时出现 = 新版事件，回放时可重现当时的掌握度计算。
     * 同时缺席 = 旧版事件，回放时 fallback 到当前配置。
     * 一半有一半没有 = 回放结果不确定，拒绝。
     */
    if (
      (payload.masteryPolicyVersion === undefined) !==
      (payload.masteryConfig === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['masteryPolicyVersion'],
        message: '掌握度策略版本与参数必须同时提供或同时缺省',
      });
    }
  });

/**
 * 服务端可信学习事实使用逐事件strict联合；通过此Schema仍不代表可以越过事务和幂等写入规则。
 */
export const domainLearningEventSchema = z
  .discriminatedUnion('eventType', [
    z
      .object({
        ...eventBaseShape,
        eventType: z.literal('state_transition'),
        payload: stateTransitionPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        eventType: z.literal('assessment_exit_decided'),
        payload: z
          .object({
            from: z.literal('ASSESS'),
            signal: z.literal('ASSESSMENT_COMPLETED'),
            decision: z.literal('ADVANCE'),
            reasons: z.array(assessmentReasonSchema).min(1),
            recentAccuracy: z.number().min(0).max(1),
            policyVersion: z.string().min(1).max(64),
            evidence: assessmentEvidenceSchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        eventType: z.literal('assessment_graded'),
        payload: assessmentPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        eventType: z.literal('hint_recorded'),
        payload: z
          .object({
            artifactId: z.string().min(1).max(128).optional(),
            contextType: z.enum([
              'diagnosis',
              'animation',
              'quiz',
              'classification_game',
            ]),
            contextId: z.string().min(1).max(128),
            hintLevel: z.number().int().min(1).max(3),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        eventType: z.literal('misconception_updated'),
        payload: z
          .object({
            tag: misconceptionTagSchema,
            status: z.enum(['active', 'resolved']),
            evidenceQuote: z.string().min(1).max(500),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        eventType: z.literal('artifact_completed'),
        payload: z
          .object({
            artifactId: z.string().min(1).max(128),
            artifactType: z
              .string()
              .min(1)
              .max(64)
              .regex(/^[a-z][a-z0-9_]*$/, 'Artifact类型必须使用snake_case'),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((event, context) => {
    /**
     * 事件 source 必须与事件类型匹配 — 每种事件只能由特定生产者签发。
     * `migration` 是唯一例外，允许写入任意类型以兼容历史数据导入。
     */
    const expectedSource =
      event.eventType === 'assessment_graded'
        ? 'grading_service'
        : event.eventType === 'misconception_updated'
          ? 'misconception_service'
          : 'teaching_runtime';
    if (event.source !== 'migration' && event.source !== expectedSource) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: `${event.eventType}不能由${event.source}签发`,
      });
    }
    /**
     * 在线 state_transition 的 reason 必须是候选信号闭集成员，
     * 且 from/to 必须与 resolveTransitionCandidate 的结果一致。
     *
     * 这层校验确保即使有 bug 的模型发出了"DIAGNOSE 时要求跳到 ASSESS"，
     * 事件在写入前就被 Schema 拒绝。
     *
     * migration 事件跳过此校验 — 历史数据可能使用自由文本 reason。
     */
    if (
      event.eventType !== 'state_transition' ||
      event.source === 'migration'
    ) {
      return;
    }
    const signal = teachingTransitionCandidateSignalSchema.safeParse(
      event.payload.reason,
    );
    if (!signal.success) {
      context.addIssue({
        code: 'custom',
        path: ['payload', 'reason'],
        message: '在线状态转移reason必须属于候选信号闭集',
      });
      return;
    }
    const resolution = resolveTransitionCandidate(
      event.payload.from,
      signal.data,
    );
    const targetMatches =
      resolution.ok &&
      (resolution.kind === 'ASSESSMENT_EXIT'
        ? event.payload.to === 'EXPLAIN' || event.payload.to === 'PRACTICE'
        : resolution.to === event.payload.to);
    if (!targetMatches) {
      context.addIssue({
        code: 'custom',
        path: ['payload', 'reason'],
        message: '状态转移reason与from/to不匹配',
      });
    }
  });

/** 已通过服务端领域Schema校验、可以进入幂等持久化流程的学习事实。 */
export type DomainLearningEvent = z.infer<typeof domainLearningEventSchema>;

/** 可信领域事件名称集合，直接从联合类型推导。 */
export type DomainLearningEventType = DomainLearningEvent['eventType'];
