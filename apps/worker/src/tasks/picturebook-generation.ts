import {
  ModelGatewayInvocationError,
  ObjectStorageError,
  type ImageGenerationModelGateway,
  type StructuredModelGateway,
} from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import {
  PICTUREBOOK_CONTENT_VERSION,
  picturebookMetadataSchema,
  picturebookPlanSchema,
} from '@educanvas/canvas-protocol';
import {
  picturebookBundleSchema,
  type PicturebookBundle,
} from '@educanvas/canvas-protocol/server';
import type {
  DrizzlePlatformArtifactRepository,
  PlatformArtifact,
  PlatformArtifactJob,
  PlatformArtifactVersion,
} from '@educanvas/db';
import { z } from 'zod';

export const PICTUREBOOK_GENERATOR =
  'model:artifact.generate:picturebook-v1' as const;
export const PICTUREBOOK_PROMPT_VERSION = 'artifact-picturebook-v1' as const;
export const PICTUREBOOK_IMAGE_PROMPT_VERSION =
  'artifact-picturebook-image-v1' as const;

const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;

interface PicturebookStoragePort {
  put(input: {
    key: string;
    bytes: Uint8Array;
    contentType?: string;
  }): Promise<{ key: string; checksum: string; sizeBytes: number }>;
  readVerified(key: string, expectedChecksum: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const picturebookCheckpointSchema = z
  .object({
    kind: z.literal('picturebook'),
    objectKey: z.string().min(1).max(1_024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: picturebookMetadataSchema,
  })
  .strict();

export class PicturebookGenerationFailure extends Error {
  override readonly name = 'PicturebookGenerationFailure';

  constructor(
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

function serializeBundle(bundle: PicturebookBundle): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(bundle));
}

async function appendCheckpointedVersion(input: {
  checkpoint: z.infer<typeof picturebookCheckpointSchema>;
  artifact: PlatformArtifact;
  job: PlatformArtifactJob;
  subjectId: string;
  artifacts: DrizzlePlatformArtifactRepository;
  storage: PicturebookStoragePort;
}): Promise<PlatformArtifactVersion> {
  const bytes = await input.storage
    .readVerified(input.checkpoint.objectKey, input.checkpoint.checksum)
    .catch((error) => {
      throw new PicturebookGenerationFailure('picturebook_checkpoint_invalid', {
        cause: error,
      });
    });
  try {
    picturebookBundleSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
  } catch (error) {
    throw new PicturebookGenerationFailure('picturebook_checkpoint_invalid', {
      cause: error,
    });
  }
  return input.artifacts.appendVersionAndCompleteGenerationJob({
    jobId: input.job.id,
    artifactId: input.artifact.id,
    trustedSubjectId: input.subjectId,
    objectKey: input.checkpoint.objectKey,
    checksum: input.checkpoint.checksum,
    metadata: input.checkpoint.metadata,
    generatedBy: PICTUREBOOK_GENERATOR,
    createdByOperationId: input.job.operationId,
  });
}

/**
 * 先生成严格分页计划，再通过唯一 Image Gateway 逐页生成插图。
 * 完整 bundle 只写入一个受校验对象，因此归档时现有删除 outbox 可完整回收。
 */
export async function appendPicturebookVersion(input: {
  artifact: PlatformArtifact;
  job: PlatformArtifactJob;
  subjectId: string;
  artifacts: DrizzlePlatformArtifactRepository;
  structuredGateway: StructuredModelGateway | null;
  imageGateway: ImageGenerationModelGateway | null;
  messages: readonly { role: 'user' | 'assistant'; content: string }[];
  instruction: string;
  storage?: PicturebookStoragePort;
  reportProgress?: (progress: number) => Promise<void>;
}): Promise<PlatformArtifactVersion> {
  const storage = input.storage ?? new LocalObjectStorage();
  if (Object.keys(input.job.checkpoint).length > 0) {
    const checkpoint = picturebookCheckpointSchema.safeParse(
      input.job.checkpoint,
    );
    if (!checkpoint.success) {
      throw new PicturebookGenerationFailure('picturebook_checkpoint_invalid');
    }
    return appendCheckpointedVersion({
      checkpoint: checkpoint.data,
      artifact: input.artifact,
      job: input.job,
      subjectId: input.subjectId,
      artifacts: input.artifacts,
      storage,
    });
  }
  if (!input.structuredGateway) {
    throw new PicturebookGenerationFailure('structured_not_configured');
  }
  if (!input.imageGateway) {
    throw new PicturebookGenerationFailure('image_not_configured');
  }

  let transcript = input.messages
    .map(
      (message) =>
        `${message.role === 'user' ? '学生' : 'AI'}: ${message.content}`,
    )
    .join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
  const planResult = await input.structuredGateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: picturebookPlanSchema,
    promptVersion: PICTUREBOOK_PROMPT_VERSION,
    traceId: `artifact:${input.artifact.id}:picturebook-plan`,
    operationId: input.job.id,
    messages: [
      {
        role: 'system',
        content: [
          '你是低龄学习绘本编排助手。把一个知识点编排成连续的中文图文故事。',
          '必须输出 6 到 8 页；每页 captionText 用 1 到 2 个短句，适合小学生朗读。',
          '每页 imagePrompt 描述同一主角、统一画风和当前场景，不要求图片生成文字。',
          '故事应有开端、探索、理解和收束；只使用对话中已有的知识，不编造事实。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `标题：${input.artifact.title}\n生成要求：${input.instruction}\n\nNotebook 对话：\n${transcript}`,
      },
    ],
  });
  await input.reportProgress?.(30);

  const pages: PicturebookBundle['pages'] = [];
  let totalImageBytes = 0;
  let totalLatencyMs = 0;
  let provider: string | null = null;
  let resolvedModelId: string | null = null;
  for (const [index, page] of planResult.output.pages.entries()) {
    let generated;
    try {
      generated = await input.imageGateway.generateImage({
        taskAlias: 'image.generate',
        modelAlias: 'image',
        prompt: `儿童知识绘本插画，统一角色与柔和手绘风格；${page.imagePrompt}；画面中不要出现文字、水印或标志。`,
        size: '512x512',
        count: 1,
        promptVersion: PICTUREBOOK_IMAGE_PROMPT_VERSION,
        traceId: `artifact:${input.artifact.id}:picturebook-page-${index + 1}`,
        operationId: input.job.id,
      });
    } catch (error) {
      if (error instanceof ModelGatewayInvocationError) {
        if (error.normalized.retryable) throw error;
        throw new PicturebookGenerationFailure(
          `image_${error.normalized.code}`,
          { cause: error },
        );
      }
      throw error;
    }
    const image = generated.images[0];
    provider ??= generated.metadata.provider;
    resolvedModelId ??= generated.metadata.resolvedModelId;
    if (
      provider !== generated.metadata.provider ||
      resolvedModelId !== generated.metadata.resolvedModelId
    ) {
      throw new PicturebookGenerationFailure('image_provider_drift');
    }
    totalImageBytes += image.bytes.byteLength;
    totalLatencyMs += generated.metadata.latencyMs;
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new PicturebookGenerationFailure('picturebook_output_too_large');
    }
    pages.push({
      ...page,
      image: {
        contentType: image.mimeType,
        byteSize: image.bytes.byteLength,
        size: '512x512',
        bytesBase64: Buffer.from(image.bytes).toString('base64'),
      },
    });
    await input.reportProgress?.(
      30 + Math.round(((index + 1) / planResult.output.pages.length) * 50),
    );
  }

  const bundle = picturebookBundleSchema.parse({
    contentVersion: PICTUREBOOK_CONTENT_VERSION,
    pages,
  });
  const metadata = picturebookMetadataSchema.parse({
    contentVersion: PICTUREBOOK_CONTENT_VERSION,
    pageCount: pages.length,
    totalImageBytes,
    image: {
      provider,
      resolvedModelId,
      totalLatencyMs,
    },
  });
  const objectKey = `artifacts/${input.artifact.id}/jobs/${input.job.id}/picturebook.json`;
  let stored;
  try {
    stored = await storage.put({
      key: objectKey,
      bytes: serializeBundle(bundle),
      contentType: 'application/vnd.educanvas.picturebook+json',
    });
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw new PicturebookGenerationFailure(`storage_${error.code}`, {
        cause: error,
      });
    }
    throw error;
  }
  const checkpoint = picturebookCheckpointSchema.parse({
    kind: 'picturebook',
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
    await storage.delete(stored.key).catch(() => undefined);
    throw error;
  }
  return appendCheckpointedVersion({
    checkpoint,
    artifact: input.artifact,
    job: input.job,
    subjectId: input.subjectId,
    artifacts: input.artifacts,
    storage,
  });
}
