import { z } from 'zod';

/**
 * 填空式编程练习的完整服务端参数。
 * starterCode 可以公开；requiredLine 与 expectedOutput 只进入私有判分键。
 */
export const codeCompletionParamsSchema = z
  .object({
    language: z.literal('python'),
    prompt: z.string().trim().min(1).max(400),
    starterCode: z.string().min(1).max(10_000),
    requiredLine: z.string().trim().min(1).max(300),
    expectedOutput: z.string().trim().min(1).max(1_000),
    successMessage: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type CodeCompletionParams = z.infer<typeof codeCompletionParamsSchema>;
