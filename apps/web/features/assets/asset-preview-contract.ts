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
]);

export type AssetPreview = z.infer<typeof assetPreviewSchema>;
