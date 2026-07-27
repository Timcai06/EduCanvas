import { z } from 'zod';

export const GENERATED_IMAGE_CONTENT_VERSION = 1 as const;

/**
 * 生成图像版本的浏览器安全元数据。
 *
 * 二进制 objectKey 与 checksum 不在该投影中，字节只能经受控读取面获取。
 * `byteSize` 上限与 `MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES` 的可配上界一致，
 * 保证适配器放行的任何图像都能被本 Schema 表达，不会出现「生成成功但元数据
 * 写不进去」的死角。
 */
export const generatedImageMetadataSchema = z
  .object({
    contentVersion: z.literal(GENERATED_IMAGE_CONTENT_VERSION),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    size: z.enum(['512x512', '1024x1024', '1024x1536', '1536x1024']),
    image: z
      .object({
        provider: z.string().min(1).max(128),
        resolvedModelId: z.string().min(1).max(256),
        latencyMs: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type GeneratedImageMetadata = z.infer<
  typeof generatedImageMetadataSchema
>;
