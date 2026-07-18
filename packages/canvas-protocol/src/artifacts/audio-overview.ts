import { z } from 'zod';

export const AUDIO_OVERVIEW_CONTENT_VERSION = 1 as const;

/**
 * 音频版本的浏览器安全元数据。二进制 key 与 checksum 不在该投影中；
 * transcript 被保存，避免昂贵且不可复现的脚本生成结果随进程丢失。
 */
export const audioOverviewMetadataSchema = z
  .object({
    contentVersion: z.literal(AUDIO_OVERVIEW_CONTENT_VERSION),
    contentType: z.literal('audio/mpeg'),
    byteSize: z.number().int().positive().max(20 * 1024 * 1024),
    transcript: z.string().min(1).max(3_500),
    sourceCount: z.number().int().min(1).max(8),
    script: z
      .object({
        generator: z.string().min(1).max(128),
        provider: z.string().min(1).max(128).nullable(),
        resolvedModelId: z.string().min(1).max(256).nullable(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        latencyMs: z.number().finite().nonnegative(),
      })
      .strict(),
    speech: z
      .object({
        provider: z.string().min(1).max(128),
        resolvedModelId: z.string().min(1).max(256),
        voice: z.string().min(1).max(128),
        inputCharacters: z.number().int().positive().max(4_096),
        latencyMs: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AudioOverviewMetadata = z.infer<
  typeof audioOverviewMetadataSchema
>;
