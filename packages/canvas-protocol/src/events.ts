import { z } from 'zod';

// Canvas交互事件只描述浏览器发生的操作，是进入服务端验证边界前的不可信输入。
// 服务端验证后产生的state_transition、assessment_graded等可信领域事件归teaching-core所有，
// 不能与本文件的客户端事件混为同一种类型（ADR-0006）。

/** 客户端Canvas交互协议版本；领域事件拥有独立版本，不能复用此常量。 */
export const CANVAS_INTERACTION_SCHEMA_VERSION = '1' as const;

/** 阶段一允许从Canvas提交到服务端的交互类型闭集。 */
export const canvasInteractionEventTypes = [
  'artifact_rendered',
  'animation_started',
  'animation_paused',
  'animation_step_completed',
  'hint_requested',
  'quiz_answer_submitted',
  'classification_submitted',
] as const;

const eventBaseShape = {
  schemaVersion: z.literal(CANVAS_INTERACTION_SCHEMA_VERSION),
  eventId: z.uuid(),
  artifactId: z.string().min(1).max(128),
  occurredAt: z.iso.datetime(),
};

const templateKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, '模板标识必须使用snake_case');

const classificationSubmissionPayloadSchema = z
  .object({
    assignments: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(128),
            categoryId: z.string().min(1).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((payload, context) => {
    const itemIds = payload.assignments.map((assignment) => assignment.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['assignments'],
        message: '同一itemId只能提交一次分类结果',
      });
    }
  });

/**
 * Canvas客户端事件使用按type判别的strict联合，每种payload只允许已评审字段。
 * 客户端不得提交isCorrect、masteryScore或目标状态；这些事实只能由服务端验证后生成。
 */
export const canvasInteractionEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...eventBaseShape,
      type: z.literal('artifact_rendered'),
      payload: z
        .object({
          artifactType: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[a-z][a-z0-9_]*$/, 'Artifact类型必须使用snake_case'),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal('animation_started'),
      payload: z
        .object({
          templateKey: templateKeySchema,
          stepId: z.string().min(1).max(128).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal('animation_paused'),
      payload: z
        .object({
          templateKey: templateKeySchema,
          stepId: z.string().min(1).max(128).optional(),
          positionMs: z.number().int().nonnegative().max(3_600_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal('animation_step_completed'),
      payload: z
        .object({
          templateKey: templateKeySchema,
          stepId: z.string().min(1).max(128),
          stepIndex: z.number().int().nonnegative().max(999),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal('hint_requested'),
      payload: z
        .object({
          contextType: z.enum(['animation', 'quiz', 'classification_game']),
          contextId: z.string().min(1).max(128),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal('quiz_answer_submitted'),
      payload: z
        .object({
          questionId: z.string().min(1).max(128),
          selectedOptionId: z.string().min(1).max(128),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal('classification_submitted'),
      payload: classificationSubmissionPayloadSchema,
    })
    .strict(),
]);

/** 可以提交给服务端验证、但尚未成为可信学习事实的Canvas交互。 */
export type CanvasInteractionEvent = z.infer<
  typeof canvasInteractionEventSchema
>;

/** Canvas交互事件名称集合，直接从协议联合推导。 */
export type CanvasInteractionEventType = CanvasInteractionEvent['type'];
