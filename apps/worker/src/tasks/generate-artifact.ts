import {
  assetVersionReferenceSchema,
  ModelGatewayInvocationError,
  ObjectStorageError,
} from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { audioOverviewMetadataSchema } from '@educanvas/canvas-protocol';
import {
  AssetAccessError,
  ArtifactJobLifecycleError,
  DrizzleAssetRepository,
  DrizzlePlatformArtifactRepository,
  DrizzlePlatformTurnRepository,
  type PlatformArtifact,
  type PlatformArtifactJob,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import {
  createWorkerModelRuntime,
  readModelGatewayEnvironment,
  type WorkerModelRuntime,
} from '../model-runtime.js';
import {
  appendGeneratedImageVersion,
  ImageArtifactGenerationFailure,
} from './image-artifact-generation.js';
import { generateAudioOverviewScript } from './audio-overview-generation.js';
import { resolveArtifactGenerationIntent } from './artifact-generation-intent.js';
import { generateMindMapContent } from './mind-map-generation.js';
import { generateFlashcardsContent } from './flashcards-generation.js';
import { generateSlidesContent } from './slides-generation.js';
import { generateNoteContent } from './note-generation.js';
import { generateMarkdownDocumentContent } from './markdown-document-generation.js';
import { generateWebAppContent } from './web-app-generation.js';

const payloadSchema = z
  .object({
    jobId: z.string().uuid(),
    artifactId: z.string().uuid(),
    subjectId: z.string().min(1).max(160),
  })
  .strict();

const audioJobParamsSchema = z
  .object({
    selectedSources: z.array(assetVersionReferenceSchema).min(1).max(8),
  })
  .strict();

const audioCheckpointSchema = z
  .object({
    kind: z.literal('audio_overview'),
    objectKey: z.string().min(1).max(1_024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: audioOverviewMetadataSchema,
  })
  .strict();

const AUDIO_GENERATOR = 'model:speech.generate:audio-overview-v1';

class ArtifactGenerationFailure extends Error {
  constructor(
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'ArtifactGenerationFailure';
  }
}

async function appendAudioOverviewVersion(input: {
  artifact: PlatformArtifact;
  job: PlatformArtifactJob;
  subjectId: string;
  artifacts: DrizzlePlatformArtifactRepository;
  /** R03：任务级一次解析的共享运行时（structured/speech 同一配置）。 */
  runtime: WorkerModelRuntime;
}) {
  const storage = new LocalObjectStorage();
  const checkpointKeys = Object.keys(input.job.checkpoint);
  if (checkpointKeys.length > 0) {
    const checkpoint = audioCheckpointSchema.safeParse(input.job.checkpoint);
    if (!checkpoint.success) {
      throw new ArtifactGenerationFailure('audio_checkpoint_invalid');
    }
    try {
      await storage.readVerified(
        checkpoint.data.objectKey,
        checkpoint.data.checksum,
      );
    } catch (error) {
      throw new ArtifactGenerationFailure('audio_checkpoint_invalid', {
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
      generatedBy: AUDIO_GENERATOR,
      createdByOperationId: input.job.operationId,
    });
  }

  const params = audioJobParamsSchema.safeParse(input.job.params);
  if (!params.success) {
    throw new ArtifactGenerationFailure('audio_sources_invalid');
  }
  let materialized;
  try {
    materialized =
      await new DrizzleAssetRepository().materializeOwnedReferences({
        ownerSubjectId: input.subjectId,
        spaceId: input.artifact.spaceId,
        references: params.data.selectedSources,
      });
  } catch (error) {
    if (error instanceof AssetAccessError) {
      throw new ArtifactGenerationFailure('audio_sources_unavailable', {
        cause: error,
      });
    }
    throw error;
  }
  if (
    materialized.some(
      (source) => !source.extractedText || !source.extractedText.trim(),
    )
  ) {
    throw new ArtifactGenerationFailure('audio_source_text_missing');
  }

  const speechGateway = input.runtime.speech;
  if (!speechGateway) {
    throw new ArtifactGenerationFailure('speech_not_configured');
  }
  const scriptResult = await generateAudioOverviewScript({
    title: input.artifact.title,
    sources: materialized.map((source) => ({
      displayName: source.displayName,
      content: source.extractedText!,
    })),
    gateway: input.runtime.structured,
    traceId: `artifact:${input.artifact.id}:script`,
    operationId: input.job.id,
  });

  let synthesized;
  try {
    synthesized = await speechGateway.generateSpeech({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      input: scriptResult.script,
      format: 'mp3',
      promptVersion: 'artifact-audio-overview-speech-v1',
      traceId: `artifact:${input.artifact.id}:speech`,
      operationId: input.job.id,
    });
  } catch (error) {
    if (error instanceof ModelGatewayInvocationError) {
      throw new ArtifactGenerationFailure(`speech_${error.normalized.code}`, {
        cause: error,
      });
    }
    throw error;
  }

  const objectKey = `artifacts/${input.artifact.id}/jobs/${input.job.id}/overview.mp3`;
  let stored;
  try {
    stored = await storage.put({
      key: objectKey,
      bytes: synthesized.bytes,
      contentType: synthesized.contentType,
    });
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw new ArtifactGenerationFailure(`storage_${error.code}`, {
        cause: error,
      });
    }
    throw error;
  }
  const metadata = audioOverviewMetadataSchema.parse({
    contentVersion: 1,
    contentType: synthesized.contentType,
    byteSize: stored.sizeBytes,
    transcript: scriptResult.script,
    sourceCount: materialized.length,
    script: scriptResult.audit,
    speech: {
      provider: synthesized.metadata.provider,
      resolvedModelId: synthesized.metadata.resolvedModelId,
      voice: synthesized.voice,
      inputCharacters: synthesized.inputCharacters,
      latencyMs: synthesized.metadata.latencyMs,
    },
  });
  const checkpoint = audioCheckpointSchema.parse({
    kind: 'audio_overview',
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
  return input.artifacts.appendVersionAndCompleteGenerationJob({
    jobId: input.job.id,
    artifactId: input.artifact.id,
    trustedSubjectId: input.subjectId,
    objectKey: stored.key,
    checksum: stored.checksum,
    metadata,
    generatedBy: AUDIO_GENERATOR,
    createdByOperationId: input.job.operationId,
  });
}

/**
 * 产物生成任务(M1 PR-J5)。账本(artifact_generation_jobs)是事实源:
 * 任何失败都先落 failed + failureCode 再吞掉异常——已记账的失败不再让
 * graphile 重试,避免对 terminal 态的重试风暴;只有"记账本身失败"才向
 * graphile 抛出换取重试。running 重投被视为 crash 恢复；audio_overview
 * 在对象写入后保存 checkpoint，避免恢复时重复调用计费 TTS。
 */
export const generateArtifact: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const artifacts = new DrizzlePlatformArtifactRepository();
  const turns = new DrizzlePlatformTurnRepository();

  const failJob = async (code: string) => {
    try {
      await artifacts.transitionGenerationJob({
        jobId: payload.jobId,
        trustedSubjectId: payload.subjectId,
        to: 'failed',
        failureCode: code,
      });
      return;
    } catch (error) {
      if (error instanceof ArtifactJobLifecycleError) {
        helpers.logger.warn(
          `任务 ${payload.jobId} 无法写 failed(${code}),已进入终态 ${error.message}`,
        );
        return;
      }
      throw error;
    }
  };

  try {
    await artifacts.transitionGenerationJob({
      jobId: payload.jobId,
      trustedSubjectId: payload.subjectId,
      to: 'running',
      progress: 5,
    });
  } catch (error) {
    if (error instanceof ArtifactJobLifecycleError) {
      /* 重复投递(如 job_key 冲突后的重放):任务已被处理过,幂等跳过。 */
      helpers.logger.warn(`任务 ${payload.jobId} 非 queued 态,跳过重复执行`);
      return;
    }
    throw error;
  }

  try {
    const artifact = await artifacts.getArtifact({
      artifactId: payload.artifactId,
      trustedSubjectId: payload.subjectId,
    });
    const existingVersion = await artifacts.findVersionByGenerationJob({
      jobId: payload.jobId,
      trustedSubjectId: payload.subjectId,
    });
    if (existingVersion) {
      try {
        await artifacts.transitionGenerationJob({
          jobId: payload.jobId,
          trustedSubjectId: payload.subjectId,
          to: 'succeeded',
          progress: 100,
        });
      } catch (error) {
        if (error instanceof ArtifactJobLifecycleError) {
          helpers.logger.warn(
            `任务 ${payload.jobId} 已不是 running,恢复路径跳过 succeeded`,
          );
          return;
        }
        throw error;
      }
      helpers.logger.info(
        `产物 ${payload.artifactId} 已有版本 v${existingVersion.version},恢复任务终态`,
      );
      return;
    }

    const supportedKinds = [
      'mind_map',
      'slides',
      'flashcards',
      'audio_overview',
      'generated_image',
      'markdown_document',
      'note',
      'web_app',
    ] as const;
    if (!(supportedKinds as readonly string[]).includes(artifact.kind)) {
      await failJob('unsupported_kind');
      return;
    }
    if (!artifact.conversationId) {
      await failJob('conversation_missing');
      return;
    }

    const job = await artifacts.getGenerationJob({
      jobId: payload.jobId,
      trustedSubjectId: payload.subjectId,
    });
    // R03：任务级一次解析环境。structured/speech/image 三个能力共用同一
    // 已验证配置（惰性：只走一个 kind 分支，至多解析一次）。
    let runtime: WorkerModelRuntime | null = null;
    const getRuntime = (): WorkerModelRuntime => {
      if (runtime === null) {
        runtime = createWorkerModelRuntime(readModelGatewayEnvironment());
      }
      return runtime;
    };
    if (artifact.kind === 'audio_overview') {
      const version = await appendAudioOverviewVersion({
        artifact,
        job,
        subjectId: payload.subjectId,
        artifacts,
        // R03：一次解析，structured/speech 共享同一已验证配置。
        runtime: getRuntime(),
      });
      helpers.logger.info(
        `音频产物 ${payload.artifactId} 生成完成,版本 v${version.version}`,
      );
      return;
    }
    if (artifact.kind === 'generated_image') {
      const version = await appendGeneratedImageVersion({
        artifact,
        job,
        subjectId: payload.subjectId,
        artifacts,
        gateway: getRuntime().image,
      });
      helpers.logger.info(
        `图像产物 ${payload.artifactId} 生成完成,版本 v${version.version}`,
      );
      return;
    }

    const generationIntent = resolveArtifactGenerationIntent(job.params);
    if (generationIntent.kind === 'invalid') {
      await failJob('generation_params_invalid');
      return;
    }
    const baseVersion =
      generationIntent.kind === 'revision'
        ? await artifacts.getVersion({
            artifactId: artifact.id,
            version: generationIntent.baseVersion,
            trustedSubjectId: payload.subjectId,
          })
        : null;

    const messages = await turns.listMessages({
      conversationId: artifact.conversationId,
      trustedSubjectId: payload.subjectId,
      limit: 40,
    });
    const generatorInput = {
      title: artifact.title,
      messages: [
        ...messages.map((message) => ({
          role:
            message.role === 'user'
              ? ('user' as const)
              : ('assistant' as const),
          content: message.content,
        })),
        ...(generationIntent.kind === 'initial'
          ? [
              {
                role: 'user' as const,
                content: `本次产物生成要求：${generationIntent.instruction}`,
              },
            ]
          : []),
      ],
      gateway: getRuntime().structured,
      traceId: `artifact:${payload.artifactId}`,
      operationId: payload.jobId,
      revision:
        generationIntent.kind === 'revision' && baseVersion
          ? {
              instruction: generationIntent.instruction,
              baseContent: baseVersion.content,
            }
          : undefined,
    };
    const { content, generatedBy } =
      artifact.kind === 'mind_map'
        ? await generateMindMapContent(generatorInput)
        : artifact.kind === 'slides'
          ? await generateSlidesContent(generatorInput)
          : artifact.kind === 'flashcards'
            ? await generateFlashcardsContent(generatorInput)
            : artifact.kind === 'markdown_document'
              ? await generateMarkdownDocumentContent(generatorInput)
              : artifact.kind === 'web_app'
                ? await generateWebAppContent(generatorInput)
                : await generateNoteContent(generatorInput);

    const version = await artifacts.appendVersionAndCompleteGenerationJob({
      jobId: payload.jobId,
      artifactId: payload.artifactId,
      trustedSubjectId: payload.subjectId,
      content,
      generatedBy,
      createdByOperationId: job.operationId,
      expectedLatestVersion:
        generationIntent.kind === 'revision'
          ? generationIntent.baseVersion
          : undefined,
    });
    helpers.logger.info(
      `产物 ${payload.artifactId} 生成完成,版本 v${version.version}`,
    );
  } catch (error) {
    if (
      error instanceof ModelGatewayInvocationError &&
      error.normalized.retryable &&
      helpers.job.attempts < helpers.job.max_attempts
    ) {
      /* 只对重试窗口抛错；失败到达终态时必须落稳定码，禁止把 provider 异常正文
         或请求参数写进 artifact 领域日志。 */
      /* 可重试的限流、超时与暂时不可用必须交回 Graphile 退避；提前结算 failed
         会让任务失去恢复机会。原始 Provider 消息不写日志。 */
      throw error;
    }
    /* 已配置模型但调用失败:以稳定模型错误码记账,不静默回退规则大纲 */
    const code =
      error instanceof ArtifactGenerationFailure ||
      error instanceof ImageArtifactGenerationFailure
        ? error.code
        : error instanceof ModelGatewayInvocationError
          ? error.normalized.retryable
            ? 'model_attempts_exhausted'
            : `model_${error.normalized.code}`
          : 'generation_failed';
    helpers.logger.error(`产物 ${payload.artifactId} 生成失败: ${code}`);
    await failJob(code);
  }
};
