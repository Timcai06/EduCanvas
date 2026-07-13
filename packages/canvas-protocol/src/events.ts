import { z } from 'zod';

// 学习事件（doc/02-architecture/canvas-and-gsap.md）：Artifact 的关键交互
// 必须产生结构化事件，用于掌握度更新和教学决策，采用只追加写入。

export const learningEventTypes = [
  'artifact_rendered',
  'animation_started',
  'animation_paused',
  'animation_step_completed',
  'animation_hint_requested',
  'animation_answer_submitted',
] as const;

export const learningEventSchema = z
  .object({
    type: z.enum(learningEventTypes),
    artifactId: z.string().min(1),
    occurredAt: z.iso.datetime(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type LearningEventType = (typeof learningEventTypes)[number];
export type LearningEvent = z.infer<typeof learningEventSchema>;
