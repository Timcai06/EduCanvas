import { z } from 'zod';

// 测验采用单选而非开放作答，便于阶段一以确定性规则批改并形成可审计的学习事件。

/**
 * 选项正文限制 120 字符，保证 2–5 个选项在手机和 Canvas 侧栏中仍能快速扫读；
 * strict 模式防止模型注入未评审的展示或行为字段。
 */
export const quizOptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1).max(120),
  })
  .strict();

/**
 * 每题限定 2–5 个选项以控制 K12 学生的选择负担；题干和解析各 300 字符，足够解释概念但不替代课程正文。
 * 跨字段校验保证正确答案真实存在，避免渲染后无法判分。
 */
export const quizQuestionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1).max(300),
    options: z.array(quizOptionSchema).min(2).max(5),
    correctOptionId: z.string().min(1),
    explanation: z.string().max(300).optional(),
  })
  .strict()
  .refine(
    (question) => question.options.some((option) => option.id === question.correctOptionId),
    { message: 'correctOptionId 必须存在于 options 中' },
  );

/**
 * 单个 Artifact 限定 1–10 题，避免一次互动过长而无法插入讲解或补救分支；
 * 题量与教学节奏要求见 docs/02-architecture/canvas-and-gsap.md。
 */
export const quizParamsSchema = z
  .object({
    questions: z.array(quizQuestionSchema).min(1).max(10),
  })
  .strict();

/** 通过单选测验协议校验、可用于确定性判分的数据。 */
export type QuizParams = z.infer<typeof quizParamsSchema>;
