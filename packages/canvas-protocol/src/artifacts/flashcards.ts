import { z } from 'zod';

/**
 * 闪卡产物内容 Schema v1(M2)。
 * 平台闪卡是**自评式**:翻面自查 + "记住了/没记住"仅存在于浏览器,
 * 不产生任何可信学习事件——K12 的服务端判分测验(canvas_artifacts)
 * 是另一条信任路径,二者不共享持久化。上限 40 张:一次复习的注意力上限,
 * 同时封死 JSONB 无界增长。
 */
const flashcardSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    front: z.string().min(1).max(200),
    back: z.string().min(1).max(400),
  })
  .strict();

export const FLASHCARDS_CONTENT_VERSION = 1 as const;

export const flashcardsContentSchema = z
  .object({
    contentVersion: z.literal(FLASHCARDS_CONTENT_VERSION),
    cards: z.array(flashcardSchema).min(1).max(40),
  })
  .strict();

export type FlashcardsContent = z.infer<typeof flashcardsContentSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
