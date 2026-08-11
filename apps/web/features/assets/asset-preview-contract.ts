import { z } from 'zod';

const fileNameSchema = z.string().trim().min(1).max(300);
const fileUrlSchema = z
  .string()
  .max(500)
  .refine((value) => value.startsWith('/api/v1/chat/assets/'));

export const assetPreviewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pdf'),
      fileName: fileNameSchema,
      mimeType: z.literal('application/pdf'),
      fileUrl: fileUrlSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('image'),
      fileName: fileNameSchema,
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      fileUrl: fileUrlSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('markdown'),
      fileName: fileNameSchema,
      mimeType: z.literal('text/markdown'),
      content: z.string().max(120_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      fileName: fileNameSchema,
      mimeType: z.literal('text/plain'),
      content: z.string().max(120_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('docx'),
      fileName: fileNameSchema,
      mimeType: z.literal(
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      ),
      /** mammoth 原格式预览 HTML；结构化可用时为空串（前端优先结构化阅读）。 */
      content: z.string().max(500_000),
      warnings: z.array(z.string()).optional(),
      /**
       * ADR-0026 决定 6：文本派生表示的实际质量；null 表示该版本没有
       * text 表示（如未走文档抽取的旧资产）。quality 为 structured 时
       * markdown 携带服务端投影后的派生内容（图片引用已是鉴权资源 URL）。
       */
      representation: z
        .object({
          quality: z.enum([
            'structured',
            'degraded_plain_text',
            'processing',
            'failed',
            'unavailable',
          ]),
          markdown: z.string().max(120_000).optional(),
        })
        .nullable()
        .optional(),
      /** 原件下载入口（决定 1：不把派生 Markdown 冒充原始 DOCX）。 */
      downloadUrl: fileUrlSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('audio'),
      fileName: fileNameSchema,
      mimeType: z.enum([
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        'audio/flac',
        'audio/webm',
        'audio/mp4',
        'audio/x-m4a',
      ]),
      fileUrl: fileUrlSchema,
      /** 转录文本是派生内容，不覆盖原始 Asset Version。 */
      transcription: z
        .object({
          text: z.string().max(500_000),
          language: z.string().max(64).nullable().optional(),
          durationSeconds: z
            .number()
            .finite()
            .positive()
            .max(3_600)
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('video'),
      fileName: fileNameSchema,
      mimeType: z.enum(['video/mp4', 'video/quicktime']),
      fileUrl: fileUrlSchema,
      transcription: z
        .object({
          text: z.string().max(500_000),
          language: z.string().max(64).nullable().optional(),
          durationSeconds: z
            .number()
            .finite()
            .positive()
            .max(3_600)
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
      derivatives: z
        .object({
          transcription: z.enum([
            'processing',
            'ready',
            'failed',
            'unavailable',
          ]),
          keyframes: z.enum(['processing', 'ready', 'failed', 'unavailable']),
        })
        .strict(),
    })
    .strict(),
]);

export type AssetPreview = z.infer<typeof assetPreviewSchema>;
