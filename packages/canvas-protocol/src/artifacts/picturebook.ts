import { z } from 'zod';

export const PICTUREBOOK_CONTENT_VERSION = 1 as const;
export const PICTUREBOOK_MIN_PAGES = 6 as const;
export const PICTUREBOOK_MAX_PAGES = 8 as const;

const controlledPageImageUrlSchema = z
  .string()
  .regex(
    /^\/api\/v1\/chat\/artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/picturebook\/pages\/[1-8]\?version=[1-9]\d*$/i,
    '绘本插图必须使用同源受控读取路径',
  );

/** 模型只负责分页语义；图片地址只能由受信服务端在生成完成后注入。 */
export const picturebookPlanPageSchema = z
  .object({
    imagePrompt: z.string().trim().min(1).max(1_000),
    captionText: z.string().trim().min(1).max(180),
  })
  .strict();

export const picturebookPlanSchema = z
  .object({
    pages: z
      .array(picturebookPlanPageSchema)
      .min(PICTUREBOOK_MIN_PAGES)
      .max(PICTUREBOOK_MAX_PAGES),
  })
  .strict();

export const publicPicturebookPageSchema = z
  .object({
    captionText: z.string().trim().min(1).max(180),
    imageUrl: controlledPageImageUrlSchema,
  })
  .strict();

export const publicPicturebookParamsSchema = z
  .object({
    pages: z
      .array(publicPicturebookPageSchema)
      .min(PICTUREBOOK_MIN_PAGES)
      .max(PICTUREBOOK_MAX_PAGES),
  })
  .strict();

/** 完整服务端 Artifact 同时保留模型分页计划与受控插图地址。 */
export const picturebookParamsSchema = z
  .object({
    pages: z
      .array(
        picturebookPlanPageSchema.extend({
          imageUrl: controlledPageImageUrlSchema,
        }),
      )
      .min(PICTUREBOOK_MIN_PAGES)
      .max(PICTUREBOOK_MAX_PAGES),
  })
  .strict();

/** 平台 Artifact 详情返回的浏览器安全内容。 */
export const picturebookContentSchema = publicPicturebookParamsSchema
  .extend({ contentVersion: z.literal(PICTUREBOOK_CONTENT_VERSION) })
  .strict();

export const picturebookMetadataSchema = z
  .object({
    contentVersion: z.literal(PICTUREBOOK_CONTENT_VERSION),
    pageCount: z
      .number()
      .int()
      .min(PICTUREBOOK_MIN_PAGES)
      .max(PICTUREBOOK_MAX_PAGES),
    totalImageBytes: z
      .number()
      .int()
      .positive()
      .max(48 * 1024 * 1024),
    image: z
      .object({
        provider: z.string().min(1).max(128),
        resolvedModelId: z.string().min(1).max(256),
        totalLatencyMs: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** 对象存储内部格式；只允许从 server 入口导入，绝不能直接投影给浏览器。 */
export const picturebookBundleSchema = z
  .object({
    contentVersion: z.literal(PICTUREBOOK_CONTENT_VERSION),
    pages: z
      .array(
        picturebookPlanPageSchema.extend({
          image: z
            .object({
              contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
              byteSize: z
                .number()
                .int()
                .positive()
                .max(20 * 1024 * 1024),
              size: z.literal('512x512'),
              bytesBase64: z
                .string()
                .min(1)
                .max(28 * 1024 * 1024),
            })
            .strict(),
        }),
      )
      .min(PICTUREBOOK_MIN_PAGES)
      .max(PICTUREBOOK_MAX_PAGES),
  })
  .strict();

export type PicturebookPlan = z.infer<typeof picturebookPlanSchema>;
export type PicturebookParams = z.infer<typeof picturebookParamsSchema>;
export type PicturebookContent = z.infer<typeof picturebookContentSchema>;
export type PicturebookBundle = z.infer<typeof picturebookBundleSchema>;
export type PicturebookMetadata = z.infer<typeof picturebookMetadataSchema>;
