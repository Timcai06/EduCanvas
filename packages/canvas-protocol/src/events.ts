import { z } from 'zod';

// 学习事件（doc/02-architecture/canvas-and-gsap.md）：Artifact 的关键交互
// 必须产生结构化事件，用于掌握度更新和教学决策，采用只追加写入。

/**
 * 阶段一允许进入事件流的闭合集合；新增值会影响掌握度计算、分析和回放，必须同步评审数据设计。
 */
export const learningEventTypes = [
  'artifact_rendered',
  'animation_started',
  'animation_paused',
  'animation_step_completed',
  'animation_hint_requested',
  'animation_answer_submitted',
] as const;

/**
 * 事件信封固定类型、Artifact 标识和带时区发生时间，保证跨端排序与审计口径一致。
 * `payload` 保持事件级扩展空间，但外层 strict，避免核心索引字段被随意改名；见 doc/04-data/data-design.md。
 */
export const learningEventSchema = z
  .object({
    type: z.enum(learningEventTypes),
    artifactId: z.string().min(1),
    occurredAt: z.iso.datetime(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/** 掌握度管线可以识别的事件类型，直接从运行时白名单推导以保持一致。 */
export type LearningEventType = (typeof learningEventTypes)[number];

/** 通过统一事件信封校验、可进入只追加事件表的 Canvas 交互。 */
export type LearningEvent = z.infer<typeof learningEventSchema>;
