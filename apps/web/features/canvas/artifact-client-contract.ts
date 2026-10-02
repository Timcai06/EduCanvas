import { z } from 'zod';
import { canvasResourceSchema } from '@educanvas/canvas-protocol';

export const artifactSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  trustTier: z.enum(['tier1', 'tier2']),
  title: z.string(),
  status: z.enum(['proposed', 'active', 'archived']),
  latestVersion: z.number().int().min(0),
});

const artifactJobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
});

export const artifactMutationResponseSchema = z.object({
  artifact: artifactSummarySchema,
  job: artifactJobSchema.pick({ id: true }).nullable(),
});

const audioOverviewMediaSchema = z
  .object({
    url: z.string(),
    downloadUrl: z.string().optional(),
    contentVersion: z.literal(1),
    contentType: z.literal('audio/mpeg'),
    byteSize: z.number().int().nonnegative(),
    transcript: z.string(),
    sourceCount: z.number().int().nonnegative(),
    script: z
      .object({
        generator: z.string(),
        provider: z.string().nullable(),
        resolvedModelId: z.string().nullable(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
      })
      .strict(),
    speech: z
      .object({
        provider: z.string(),
        resolvedModelId: z.string(),
        voice: z.string(),
        inputCharacters: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const generatedImageMediaSchema = z
  .object({
    url: z
      .string()
      .regex(
        /^\/api\/v1\/chat\/artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/image$/i,
        '生成图片必须使用同源受控读取路径',
      ),
    downloadUrl: z
      .string()
      .regex(
        /^\/api\/v1\/chat\/artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i,
        '生成图片必须使用同源受控下载路径',
      )
      .optional(),
    contentVersion: z.literal(1),
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

export const artifactDetailSchema = z.object({
  artifact: artifactSummarySchema.extend({
    fromConversation: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  version: z
    .object({
      id: z.string().uuid(),
      version: z.number().int().min(1),
      content: z.unknown(),
      media: z
        .union([audioOverviewMediaSchema, generatedImageMediaSchema])
        .nullable(),
    })
    .nullable(),
  versions: z.array(
    z.object({
      version: z.number().int().min(1),
      generatedBy: z.string().nullable(),
      revisionInstruction: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  latestJob: artifactJobSchema
    .extend({
      progress: z.number().int().min(0).max(100).nullable(),
      failureCode: z.string().nullable(),
    })
    .nullable(),
  // R06/#306：服务端 projection 是 CanvasResource 唯一权威，client 用 canonical
  // schema 完整验证并保留（不再只取 allowedActions、不再在浏览器端按 kind 重建）。
  // 服务端协议非法时 parse 失败（fail closed），不允许浏览器自行修补。
  canvasResource: canvasResourceSchema.optional(),
});
