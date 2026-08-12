import { z } from 'zod';

/** markdown 文档内容版本。 */
export const MARKDOWN_DOCUMENT_CONTENT_VERSION = 1 as const;
export const MARKDOWN_DOCUMENT_KIND = 'document.markdown.v1' as const;

/** markdown 文档最多 60,000 个 UTF-16 code units。 */
export const MARKDOWN_DOCUMENT_MAX_CHARS = 60_000;

/**
 * 学术/课程文档产物的 Markdown 内容协议。
 * 该协议仅允许纯 Markdown 文本，禁止 HTML 混入；`kind` 语义在 Artifact 层统一声明
 * 为 `document.markdown.v1`。
 */
export const markdownDocumentContentSchema = z
  .object({
    contentVersion: z.literal(MARKDOWN_DOCUMENT_CONTENT_VERSION),
    markdown: z.string().max(MARKDOWN_DOCUMENT_MAX_CHARS),
    sourceConversationId: z.string().uuid().optional(),
    generatedByModel: z.boolean(),
  })
  .strict();

export type MarkdownDocumentContent = z.infer<
  typeof markdownDocumentContentSchema
>;
