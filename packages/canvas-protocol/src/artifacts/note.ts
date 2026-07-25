import { z } from 'zod';

/** note 内容版本，初始为 1。 */
export const NOTE_CONTENT_VERSION = 1;

/**
 * 单版笔记最多 30,000 个 UTF-16 code units。这个上限覆盖长篇课堂笔记，
 * 同时约束 API、数据库 JSONB、模型结构化输出和浏览器 Markdown 渲染成本。
 */
export const NOTE_MARKDOWN_MAX_CHARS = 30_000;

/**
 * Notebook Studio 的 Markdown 笔记协议。来源会话只接受 UUID，避免把任意
 * 外部标识塞入公开产物；调用方仍需在服务端验证会话归属。
 */
export const noteContentSchema = z
  .object({
    contentVersion: z.literal(NOTE_CONTENT_VERSION),
    markdown: z.string().max(NOTE_MARKDOWN_MAX_CHARS),
    sourceConversationId: z.string().uuid().optional(),
    generatedByModel: z.boolean(),
  })
  .strict();

export type NoteContent = z.infer<typeof noteContentSchema>;
