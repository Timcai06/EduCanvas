import { z } from 'zod';
import { pipelineFlowSlotSchema } from './artifacts/pipeline-flow';

/**
 * Canvas 交互事件 — 客户端到服务端的不可信输入。
 *
 * ## 与领域事件的区别（ADR-0006）
 *
 * | 维度 | Canvas 交互事件（本文件） | 领域事件（teaching-core） |
 * |------|--------------------------|---------------------------|
 * | 来源 | 浏览器，不可信 | 服务端，可信 |
 * | 用途 | 描述用户操作（点了什么、拖了什么） | 描述已发生的事实（状态转移、判分结果） |
 * | 持久化 | 不持久化 | 持久化到 learning_events |
 * | 回放 | 不回放 | 回放用于投影计算 |
 *
 * 服务端收到 Canvas 交互事件后做校验 + 判分，产出可信领域事件。
 * 这两个事件流有独立的 Schema 版本。
 *
 * ## 七种事件类型
 *
 * | 事件 | 触发时机 | 来源 |
 * |------|---------|------|
 * | artifact_rendered | Canvas 渲染完毕 | 任意 Artifact |
 * | animation_started | 动画开始播放 | pipeline_flow |
 * | animation_paused | 动画暂停 | pipeline_flow |
 * | animation_step_completed | 动画某个步骤播完 | pipeline_flow |
 * | hint_requested | 学生点提示按钮 | quiz / classification_game / animation |
 * | quiz_answer_submitted | 学生提交单选题答案 | quiz |
 * | classification_submitted | 学生提交分类结果 | classification_game |
 */

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

const animationTemplateKeySchema = z.literal('pipeline_flow');

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
          templateKey: animationTemplateKeySchema,
          stepId: pipelineFlowSlotSchema.optional(),
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
          templateKey: animationTemplateKeySchema,
          stepId: pipelineFlowSlotSchema.optional(),
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
          templateKey: animationTemplateKeySchema,
          stepId: pipelineFlowSlotSchema,
          stepIndex: z.number().int().nonnegative().max(3),
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
