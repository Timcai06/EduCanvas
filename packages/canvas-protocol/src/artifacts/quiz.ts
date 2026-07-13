import { z } from 'zod';

// 测验：单选题列表，自动批改，答错时展示解释。

export const quizOptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1).max(120),
  })
  .strict();

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

export const quizParamsSchema = z
  .object({
    questions: z.array(quizQuestionSchema).min(1).max(10),
  })
  .strict();

export type QuizParams = z.infer<typeof quizParamsSchema>;
