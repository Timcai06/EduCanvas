import { z } from 'zod';

export const canvasResourceErrorCodes = [
  'resource_not_found',
  'resource_invalid',
  'resource_unavailable',
  'renderer_not_found',
  'renderer_version_unsupported',
  'runtime_unavailable',
  'operation_not_allowed',
] as const;

export const canvasResourceErrorCodeSchema = z.enum(canvasResourceErrorCodes);

/**
 * Canvas公共错误不区分“不存在”和“无权访问”，避免泄露跨Notebook资源存在性。
 * message必须是服务端生成的稳定用户文案，不能放Provider原文、堆栈或私有路径。
 */
export const canvasResourceErrorSchema = z
  .object({
    code: canvasResourceErrorCodeSchema,
    message: z.string().trim().min(1).max(300),
    retryable: z.boolean(),
  })
  .strict();

export type CanvasResourceErrorCode = z.infer<
  typeof canvasResourceErrorCodeSchema
>;
export type CanvasResourceError = z.infer<typeof canvasResourceErrorSchema>;
