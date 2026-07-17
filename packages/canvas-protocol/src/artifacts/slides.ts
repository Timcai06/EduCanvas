import { z } from 'zod';

/**
 * Slides 产物内容 Schema v1(M2)。
 * 上限原因:20 页/每页 8 条要点已是"对话小结"的表达上限,更长的内容属于
 * 文档而非 Slides;与 mind_map 一致,Schema 同时封死 JSONB 无界增长。
 * 导出(PPTX/PDF)后置,本版只定义可渲染结构。
 */
const slideSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().min(1).max(80),
    bullets: z.array(z.string().min(1).max(160)).max(8).default([]),
    notes: z.string().max(500).optional(),
  })
  .strict();

export const SLIDES_CONTENT_VERSION = 1 as const;

export const slidesContentSchema = z
  .object({
    contentVersion: z.literal(SLIDES_CONTENT_VERSION),
    slides: z.array(slideSchema).min(1).max(20),
  })
  .strict();

export type SlidesContent = z.infer<typeof slidesContentSchema>;
export type Slide = z.infer<typeof slideSchema>;
