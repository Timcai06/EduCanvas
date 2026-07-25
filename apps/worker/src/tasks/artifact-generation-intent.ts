import { z } from 'zod';

const revisionJobParamsSchema = z
  .object({
    revision: z
      .object({
        baseVersion: z.number().int().min(1),
        instruction: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  })
  .strict();

const initialGenerationJobParamsSchema = z
  .object({
    generation: z
      .object({
        instruction: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  })
  .strict();

export type ArtifactGenerationIntent =
  | { kind: 'conversation' }
  | { kind: 'initial'; instruction: string }
  | { kind: 'revision'; baseVersion: number; instruction: string }
  | { kind: 'invalid' };

/**
 * 将持久 Job 参数收敛成互斥意图。空对象保留 Studio 的“按整段对话生成”
 * 兼容路径；Agent 初始生成与 Canvas 修订不能同时出现，未知字段 fail closed。
 */
export function resolveArtifactGenerationIntent(
  params: Record<string, unknown>,
): ArtifactGenerationIntent {
  if (Object.keys(params).length === 0) return { kind: 'conversation' };
  const revision = revisionJobParamsSchema.safeParse(params);
  if (revision.success) {
    return { kind: 'revision', ...revision.data.revision };
  }
  const initial = initialGenerationJobParamsSchema.safeParse(params);
  if (initial.success) {
    return { kind: 'initial', ...initial.data.generation };
  }
  return { kind: 'invalid' };
}
