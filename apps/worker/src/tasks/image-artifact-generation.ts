import {
  ModelGatewayInvocationError,
  ObjectStorageError,
  supportedGeneratedImageSizes,
  type ImageGenerationModelGateway,
} from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { generatedImageMetadataSchema } from '@educanvas/canvas-protocol';
import type {
  DrizzlePlatformArtifactRepository,
  PlatformArtifact,
  PlatformArtifactJob,
  PlatformArtifactVersion,
} from '@educanvas/db';
import { z } from 'zod';

export const IMAGE_GENERATOR = 'model:image.generate:canvas-image-v1';

const IMAGE_PROMPT_VERSION = 'artifact-generated-image-v1';

/**
 * 任务参数只接受服务端已裁剪的提示词与闭集尺寸。提示词长度上界与工具入口
 * 一致，超出即视为参数损坏而不是截断——静默截断会让产物与用户请求不符。
 */
export const imageJobParamsSchema = z
  .object({
    image: z
      .object({
        prompt: z.string().trim().min(1).max(2_000),
        size: z.enum(supportedGeneratedImageSizes),
      })
      .strict(),
  })
  .strict();

/**
 * 检查点在对象写入成功后、版本追加之前保存，使 crash 恢复不重复调用计费的
 * 图像生成；`kind` 显式区分于音频检查点，避免两类媒体任务互相误读。
 */
const imageCheckpointSchema = z
  .object({
    kind: z.literal('generated_image'),
    objectKey: z.string().min(1).max(1_024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: generatedImageMetadataSchema,
  })
  .strict();

/** 稳定失败码；它们落进 artifact_generation_jobs.failure_code，只能追加。 */
export class ImageArtifactGenerationFailure extends Error {
  override readonly name = 'ImageArtifactGenerationFailure';

  constructor(
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

/**
 * 生成图像并追加为不可变 Artifact Version。
 *
 * 内容事实仍是既有的 artifact_versions + 受控对象存储，不新增内容表。
 * Provider 原始响应、Prompt 全文、objectKey 与堆栈都不进入返回给浏览器的
 * 投影：只有 `generatedImageMetadataSchema` 允许的字段会落进 metadata。
 */
export async function appendGeneratedImageVersion(input: {
  artifact: PlatformArtifact;
  job: PlatformArtifactJob;
  subjectId: string;
  artifacts: DrizzlePlatformArtifactRepository;
  gateway: ImageGenerationModelGateway | null;
}): Promise<PlatformArtifactVersion> {
  const storage = new LocalObjectStorage();
  if (Object.keys(input.job.checkpoint).length > 0) {
    const checkpoint = imageCheckpointSchema.safeParse(input.job.checkpoint);
    if (!checkpoint.success) {
      throw new ImageArtifactGenerationFailure('image_checkpoint_invalid');
    }
    try {
      await storage.readVerified(
        checkpoint.data.objectKey,
        checkpoint.data.checksum,
      );
    } catch (error) {
      throw new ImageArtifactGenerationFailure('image_checkpoint_invalid', {
        cause: error,
      });
    }
    return input.artifacts.appendVersionAndCompleteGenerationJob({
      jobId: input.job.id,
      artifactId: input.artifact.id,
      trustedSubjectId: input.subjectId,
      objectKey: checkpoint.data.objectKey,
      checksum: checkpoint.data.checksum,
      metadata: checkpoint.data.metadata,
      generatedBy: IMAGE_GENERATOR,
      createdByOperationId: input.job.operationId,
    });
  }

  const params = imageJobParamsSchema.safeParse(input.job.params);
  if (!params.success) {
    throw new ImageArtifactGenerationFailure('image_params_invalid');
  }
  if (!input.gateway) {
    throw new ImageArtifactGenerationFailure('image_not_configured');
  }

  /* Gateway 只接受已校验的提示词和 size；如果后端返回非 schema 兼容结果，
   * 本任务不尝试自修复，只回退为稳定失败码。 */

  let generated;
  try {
    generated = await input.gateway.generateImage({
      taskAlias: 'image.generate',
      modelAlias: 'image',
      prompt: params.data.image.prompt,
      size: params.data.image.size,
      count: 1,
      promptVersion: IMAGE_PROMPT_VERSION,
      traceId: `artifact:${input.artifact.id}:image`,
      operationId: input.job.id,
    });
  } catch (error) {
    if (error instanceof ModelGatewayInvocationError) {
      if (error.normalized.retryable) throw error;
      throw new ImageArtifactGenerationFailure(
        `image_${error.normalized.code}`,
        { cause: error },
      );
    }
    throw error;
  }

  const image = generated.images[0];
  const extension = image.mimeType.slice('image/'.length);
  const objectKey = `artifacts/${input.artifact.id}/jobs/${input.job.id}/image.${extension}`;
  let stored;
  try {
    stored = await storage.put({
      key: objectKey,
      bytes: image.bytes,
      contentType: image.mimeType,
    });
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw new ImageArtifactGenerationFailure(`storage_${error.code}`, {
        cause: error,
      });
    }
    throw error;
  }

  const metadata = generatedImageMetadataSchema.parse({
    contentVersion: 1,
    contentType: image.mimeType,
    byteSize: stored.sizeBytes,
    size: image.size,
    image: {
      provider: generated.metadata.provider,
      resolvedModelId: generated.metadata.resolvedModelId,
      latencyMs: generated.metadata.latencyMs,
    },
  });
  const checkpoint = imageCheckpointSchema.parse({
    kind: 'generated_image',
    objectKey: stored.key,
    checksum: stored.checksum,
    metadata,
  });
  try {
    await input.artifacts.updateGenerationJobCheckpoint({
      jobId: input.job.id,
      trustedSubjectId: input.subjectId,
      checkpoint,
    });
  } catch (error) {
    /* 检查点没落库就留下孤儿对象，恢复时会重复计费；先回收再上抛。 */
    await storage.delete(stored.key).catch(() => undefined);
    throw error;
  }
  return input.artifacts.appendVersionAndCompleteGenerationJob({
    jobId: input.job.id,
    artifactId: input.artifact.id,
    trustedSubjectId: input.subjectId,
    objectKey: stored.key,
    checksum: stored.checksum,
    metadata,
    generatedBy: IMAGE_GENERATOR,
    createdByOperationId: input.job.operationId,
  });
}
