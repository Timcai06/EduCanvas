import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import {
  ArtifactJobLifecycleError,
  DrizzlePlatformArtifactRepository,
  DrizzlePlatformTurnRepository,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { resolveStructuredModelGateway } from '../model-runtime.js';
import { generateMindMapContent } from './mind-map-generation.js';
import { generateFlashcardsContent } from './flashcards-generation.js';
import { generateSlidesContent } from './slides-generation.js';

const payloadSchema = z
  .object({
    jobId: z.string().uuid(),
    artifactId: z.string().uuid(),
    subjectId: z.string().min(1).max(160),
  })
  .strict();

/**
 * 产物生成任务(M1 PR-J5)。账本(artifact_generation_jobs)是事实源:
 * 任何失败都先落 failed + failureCode 再吞掉异常——已记账的失败不再让
 * graphile 重试,避免对 terminal 态的重试风暴;只有"记账本身失败"才向
 * graphile 抛出换取重试。当前支持 kind=mind_map 的确定性大纲 v1,
 * 模型驱动生成随 M2 替换内容构建器,管线不变。
 */
export const generateArtifact: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const artifacts = new DrizzlePlatformArtifactRepository();
  const turns = new DrizzlePlatformTurnRepository();

  const failJob = async (code: string) => {
    await artifacts.transitionGenerationJob({
      jobId: payload.jobId,
      trustedSubjectId: payload.subjectId,
      to: 'failed',
      failureCode: code,
    });
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
    const supportedKinds = ['mind_map', 'slides', 'flashcards'] as const;
    if (!(supportedKinds as readonly string[]).includes(artifact.kind)) {
      await failJob('unsupported_kind');
      return;
    }
    if (!artifact.conversationId) {
      await failJob('conversation_missing');
      return;
    }

    const messages = await turns.listMessages({
      conversationId: artifact.conversationId,
      trustedSubjectId: payload.subjectId,
      limit: 40,
    });
    const generatorInput = {
      title: artifact.title,
      messages: messages.map((message) => ({
        role:
          message.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      })),
      gateway: resolveStructuredModelGateway(),
      traceId: `artifact:${payload.artifactId}`,
      operationId: payload.jobId,
    };
    const { content, generatedBy } =
      artifact.kind === 'mind_map'
        ? await generateMindMapContent(generatorInput)
        : artifact.kind === 'slides'
          ? await generateSlidesContent(generatorInput)
          : await generateFlashcardsContent(generatorInput);

    const version = await artifacts.appendVersion({
      artifactId: payload.artifactId,
      trustedSubjectId: payload.subjectId,
      content,
      generatedBy,
      generationJobId: payload.jobId,
    });
    await artifacts.transitionGenerationJob({
      jobId: payload.jobId,
      trustedSubjectId: payload.subjectId,
      to: 'succeeded',
      progress: 100,
    });
    helpers.logger.info(
      `产物 ${payload.artifactId} 生成完成,版本 v${version.version}`,
    );
  } catch (error) {
    helpers.logger.error(
      `产物 ${payload.artifactId} 生成失败: ${(error as Error).message}`,
    );
    /* 已配置模型但调用失败:以稳定模型错误码记账,不静默回退规则大纲 */
    const code =
      error instanceof ModelGatewayInvocationError
        ? `model_${error.normalized.code}`
        : 'generation_failed';
    await failJob(code);
  }
};
