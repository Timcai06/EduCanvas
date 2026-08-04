import { z } from 'zod';

const dependencySchema = z
  .object({
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
  })
  .strict();

/**
 * 第一版持久 DOM Runtime 只接收自包含的不可变文档。
 * 依赖声明仍进入 U11 门禁；当前 Adapter 只执行空依赖集合，避免伪装已提供包加载。
 */
export const domExplorationContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    html: z.string().max(64 * 1024),
    css: z.string().max(32 * 1024),
    script: z.string().max(128 * 1024),
    dependencies: z.array(dependencySchema).max(4),
  })
  .strict();

export type DomExplorationContent = z.infer<typeof domExplorationContentSchema>;
