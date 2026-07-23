import { z } from 'zod';

/**
 * 思维导图产物内容 Schema v1(M1 PR-J5 / M2)。
 * 数量与深度上限的原因:导图是"一屏读懂"的概览产物,120 节点/4 层已超出
 * 可读极限,更大的图应该拆产物而不是放宽约束;上限同时封死 JSONB 内容的
 * 无界增长(artifact_versions.content 无独立大小约束,靠 Schema 兜底)。
 */
const mindMapLeafSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    label: z.string().min(1).max(120),
  })
  .strict();

type MindMapNodeInput = z.infer<typeof mindMapLeafSchema> & {
  children?: MindMapNodeInput[];
};

const mindMapNodeSchema: z.ZodType<MindMapNodeInput> = mindMapLeafSchema
  .extend({
    children: z.lazy(() => z.array(mindMapNodeSchema).max(12)).optional(),
  })
  .strict() as z.ZodType<MindMapNodeInput>;

export const MIND_MAP_CONTENT_VERSION = 1 as const;

export const mindMapContentSchema = z
  .object({
    contentVersion: z.literal(MIND_MAP_CONTENT_VERSION),
    root: mindMapNodeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    let count = 0;
    let tooDeep = false;
    const walk = (node: MindMapNodeInput, depth: number) => {
      count += 1;
      if (depth > 4) tooDeep = true;
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(value.root, 1);
    if (count > 120) {
      context.addIssue({
        code: 'custom',
        message: '思维导图节点数超过 120 上限',
      });
    }
    if (tooDeep) {
      context.addIssue({
        code: 'custom',
        message: '思维导图深度超过 4 层上限',
      });
    }
  });

export type MindMapContent = z.infer<typeof mindMapContentSchema>;
export type MindMapNode = MindMapNodeInput;
