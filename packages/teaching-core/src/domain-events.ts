import { z } from 'zod';
import { misconceptionTagSchema } from './mastery';
import { teachingStateSchema } from './state-machine';
import { teachingTools } from './tools';

/** 服务端可信领域事件协议版本，与客户端Canvas事件版本独立演进。 */
export const DOMAIN_EVENT_SCHEMA_VERSION = '1' as const;

/** 阶段一可写入learning_events并参与回放的领域事件闭集。 */
export const domainLearningEventTypes = [
  'state_transition',
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

const assessmentPayloadSchema = z
  .object({
    artifactId: z.string().min(1).max(128),
    assessmentType: z.enum(['quiz', 'classification_game']),
    attemptedItems: z.number().int().positive().max(100),
    correctItems: z.number().int().nonnegative().max(100),
    usedHint: z.boolean(),
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
  });

/**
 * 服务端可信学习事实使用逐事件strict联合；通过此Schema仍不代表可以越过事务和幂等写入规则。
 */
export const domainLearningEventSchema = z.discriminatedUnion('eventType', [
  z
    .object({
      ...eventBaseShape,
      eventType: z.literal('state_transition'),
      payload: z
        .object({
          from: teachingStateSchema,
          to: teachingStateSchema,
          reason: z.string().min(1).max(300),
          triggerTool: z.enum(teachingTools).optional(),
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
]);

/** 已通过服务端领域Schema校验、可以进入幂等持久化流程的学习事实。 */
export type DomainLearningEvent = z.infer<typeof domainLearningEventSchema>;

/** 可信领域事件名称集合，直接从联合类型推导。 */
export type DomainLearningEventType = DomainLearningEvent['eventType'];
