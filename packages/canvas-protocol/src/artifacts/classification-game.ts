import { z } from 'zod';

// 分类游戏：学生把若干项目拖入正确的类别（阶段一示范课的"猫狗分类"）。
// 项目用 emoji + 文字表示，不引用外部图片 URL，避免资源审核问题。

/**
 * 分类标签限制 20 字符，确保 2–4 个投放区在学生端窄屏仍可并排辨认；
 * strict 模式阻止模型附带未经渲染器评审的样式或行为字段。
 */
export const classificationCategorySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(20),
  })
  .strict();

/**
 * 待分类项目保持短标签并仅允许内联 emoji：20 字符避免卡片变成正文，8 字符为组合 emoji 留余量，
 * 同时不引入待审核的外部图片地址。资源边界见 docs/06-quality/security-and-privacy.md。
 */
export const classificationItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(20),
    emoji: z.string().min(1).max(8),
    correctCategoryId: z.string().min(1),
  })
  .strict();

/**
 * 单局限定 2–4 类、2–12 项，兼顾“必须比较”与 K12 单屏任务时长；提示和反馈限定 200 字符，
 * 防止教学解释挤占交互区。跨字段校验保证每个答案都引用本局类别，见 Canvas 协议 ADR-0002。
 */
export const classificationGameParamsSchema = z
  .object({
    prompt: z.string().min(1).max(200),
    categories: z.array(classificationCategorySchema).min(2).max(4),
    items: z.array(classificationItemSchema).min(2).max(12),
    successMessage: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    const categoryIds = params.categories.map((category) => category.id);
    const itemIds = params.items.map((item) => item.id);

    if (new Set(categoryIds).size !== categoryIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'category id不能重复',
      });
    }
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'item id不能重复',
      });
    }

    const categoryIdSet = new Set(categoryIds);
    params.items.forEach((item, index) => {
      if (!categoryIdSet.has(item.correctCategoryId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'correctCategoryId'],
          message: 'correctCategoryId必须存在于categories中',
        });
      }
    });
  });

/** 通过分类游戏协议校验、可直接交给预注册组件的数据。 */
export type ClassificationGameParams = z.infer<
  typeof classificationGameParamsSchema
>;
