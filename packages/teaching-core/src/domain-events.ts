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

/** 允许签发可信领域事件的服务端生产者闭集。 */
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
    // 历史migration事件可能使用自由文本；当前runtime在联合Schema的跨字段校验中收紧为闭集信号。
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
    const expectedSource =
      event.eventType === 'assessment_graded'
        ? 'grading_service'
        : event.eventType === 'misconception_updated'
          ? 'misconception_service'
          : 'teaching_runtime';
    // migration是已有事实的显式兼容通道；在线生产者必须与事件类型严格匹配。
    if (event.source !== 'migration' && event.source !== expectedSource) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: `${event.eventType}不能由${event.source}签发`,
      });
    }
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
