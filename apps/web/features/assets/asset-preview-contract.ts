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
      content: z.string().max(500_000),
      warnings: z.array(z.string()).optional(),
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
]);

export type AssetPreview = z.infer<typeof assetPreviewSchema>;
