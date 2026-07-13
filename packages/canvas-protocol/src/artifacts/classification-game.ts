import { z } from 'zod';

// 分类游戏：学生把若干项目拖入正确的类别（阶段一示范课的"猫狗分类"）。
// 项目用 emoji + 文字表示，不引用外部图片 URL，避免资源审核问题。

export const classificationCategorySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(20),
  })
  .strict();

export const classificationItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(20),
    emoji: z.string().min(1).max(8),
    correctCategoryId: z.string().min(1),
  })
  .strict();

export const classificationGameParamsSchema = z
  .object({
    prompt: z.string().min(1).max(200),
    categories: z.array(classificationCategorySchema).min(2).max(4),
    items: z.array(classificationItemSchema).min(2).max(12),
    successMessage: z.string().max(200).optional(),
  })
  .strict()
  .refine(
    (params) => {
      const categoryIds = new Set(params.categories.map((c) => c.id));
      return params.items.every((item) => categoryIds.has(item.correctCategoryId));
    },
    { message: '每个 item 的 correctCategoryId 必须存在于 categories 中' },
  );

export type ClassificationGameParams = z.infer<typeof classificationGameParamsSchema>;
