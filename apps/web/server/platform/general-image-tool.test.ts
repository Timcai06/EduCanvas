import type { AgentToolContext } from '@educanvas/agent-runtime';
import type { PlatformArtifact, PlatformArtifactJob } from '@educanvas/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  GENERATED_IMAGE_ARTIFACT_KIND,
  isImageGenerationConfigured,
  WebOperationImageArtifacts,
} from './general-image-tool';

vi.mock('server-only', () => ({}));

const identity: AnonymousIdentity = {
  token: 'test-token',
  studentId: 'student-1',
};
const context: AgentToolContext = {
  traceId: 'trace-1',
  turnId: 'turn-1',
  subjectId: identity.studentId,
  conversationId: 'conversation-1',
};
const artifact: PlatformArtifact = {
  id: '10331832-85cc-4ed4-b85a-32ac829e4599',
  spaceId: 'space-1',
  conversationId: context.conversationId,
  ownerSubjectId: identity.studentId,
  kind: GENERATED_IMAGE_ARTIFACT_KIND,
  trustTier: 'tier2',
  title: '光合作用示意图',
  status: 'proposed',
  latestVersion: 0,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};
const job: PlatformArtifactJob = {
  id: '2bd08cb5-5a36-444f-b76f-f31cbd44eef9',
  artifactId: artifact.id,
  operationId: 'operation-1',
  status: 'queued',
  progress: null,
  failureCode: null,
  params: {},
  checkpoint: {},
  queueJobKey: `artifact-generate:${artifact.id}`,
};

function createOperationImages(
  createArtifactWithGenerationJob = vi
    .fn()
    .mockResolvedValue({ artifact, job }),
) {
  return {
    repository: { createArtifactWithGenerationJob },
    operationImages: new WebOperationImageArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
      },
      { createArtifactWithGenerationJob },
    ),
  };
}

describe('WebOperationImageArtifacts', () => {
  it('拒绝把同一 Turn 已有的文档 Artifact 伪装成图片', async () => {
    const { operationImages } = createOperationImages(
      vi.fn().mockResolvedValue({
        artifact: { ...artifact, kind: 'mind_map' },
        job,
        replayed: true,
      }),
    );

    await expect(
      operationImages
        .createTool()
        .handler({ title: '示意图', prompt: '画一张示意图' }, context),
    ).rejects.toThrow('artifact_already_proposed_for_turn');
    expect(operationImages.events()).toEqual([]);
  });

  it('以可信 Notebook 范围原子入队并投影 tier2 proposed 事件', async () => {
    const { repository, operationImages } = createOperationImages();

    const output = await operationImages.createTool().handler(
      {
        title: artifact.title,
        prompt: '一张展示光合作用过程的示意图，标注光照、二氧化碳与水。',
        size: '1024x1536',
      },
      context,
    );

    expect(repository.createArtifactWithGenerationJob).toHaveBeenCalledWith({
      spaceId: artifact.spaceId,
      conversationId: context.conversationId,
      trustedSubjectId: identity.studentId,
      operationId: 'operation-1',
      kind: GENERATED_IMAGE_ARTIFACT_KIND,
      trustTier: 'tier2',
      title: artifact.title,
      taskIdentifier: 'artifact:generate',
      idempotencyKey: 'general-turn-artifact:operation-1',
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      params: {
        image: {
          prompt: '一张展示光合作用过程的示意图，标注光照、二氧化碳与水。',
          size: '1024x1536',
        },
      },
    });
    expect(output).toEqual({
      artifactId: artifact.id,
      jobId: job.id,
      kind: GENERATED_IMAGE_ARTIFACT_KIND,
      title: artifact.title,
      status: 'proposed',
    });
    expect(operationImages.events()).toEqual([
      {
        protocol: 'educanvas.turn.v2',
        operationId: 'operation-1',
        type: 'artifact.proposed',
        artifactId: artifact.id,
        artifactKind: GENERATED_IMAGE_ARTIFACT_KIND,
        trustTier: 'tier2',
        title: artifact.title,
      },
    ]);
  });

  it('未指定尺寸时落到闭集默认值，不接受任意宽高', async () => {
    const { repository, operationImages } = createOperationImages();

    await operationImages
      .createTool()
      .handler({ title: '示意图', prompt: '画一张电路图' }, context);
    expect(
      repository.createArtifactWithGenerationJob.mock.calls[0]![0].params,
    ).toEqual({ image: { prompt: '画一张电路图', size: '1024x1024' } });

    await expect(
      operationImages.createTool().handler(
        {
          title: '示意图',
          prompt: '画一张电路图',
          size: '4096x4096' as never,
        },
        context,
      ),
    ).rejects.toThrow();
  });

  it('拒绝 Tool Kernel 注入范围与组合根不一致', async () => {
    const { repository, operationImages } = createOperationImages(vi.fn());

    await expect(
      operationImages
        .createTool()
        .handler(
          { title: '示意图', prompt: '画一张电路图', size: '512x512' },
          { ...context, subjectId: 'student-2' },
        ),
    ).rejects.toThrow('canvas_image_scope_mismatch');
    await expect(
      operationImages
        .createTool()
        .handler(
          { title: '示意图', prompt: '画一张电路图', size: '512x512' },
          { ...context, conversationId: 'conversation-2' },
        ),
    ).rejects.toThrow('canvas_image_scope_mismatch');
    expect(repository.createArtifactWithGenerationJob).not.toHaveBeenCalled();
  });

  it('工具重复调用按产物聚合事件，不产生重复 proposed', async () => {
    const { operationImages } = createOperationImages();

    for (let index = 0; index < 3; index += 1) {
      await operationImages
        .createTool()
        .handler(
          { title: artifact.title, prompt: '画一张示意图', size: '512x512' },
          context,
        );
    }

    expect(operationImages.events()).toHaveLength(1);
  });
});

describe('isImageGenerationConfigured', () => {
  const original = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('MODEL_GATEWAY_') ||
        key === 'EDUCANVAS_DEPLOYMENT_ENV'
      ) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('缺少任一必要配置时默认拒绝', () => {
    expect(isImageGenerationConfigured()).toBe(false);

    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
    process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
    process.env.MODEL_GATEWAY_BASE_URL = 'https://provider.invalid/v1';
    process.env.MODEL_GATEWAY_API_KEY = 'fixture';
    process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'text-model';
    /* 网关已启用但没有 image 模型别名：能力仍不开放。 */
    expect(isImageGenerationConfigured()).toBe(false);
  });

  it('配置非法时不抛出也不开放能力', () => {
    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
    process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
    process.env.MODEL_GATEWAY_BASE_URL = 'not-a-url';
    process.env.MODEL_GATEWAY_API_KEY = 'fixture';
    process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'text-model';
    process.env.MODEL_GATEWAY_IMAGE_MODEL = 'image-model';

    expect(isImageGenerationConfigured()).toBe(false);
  });

  it('完整配置后开放能力', () => {
    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
    process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
    process.env.MODEL_GATEWAY_BASE_URL = 'https://provider.invalid/v1';
    process.env.MODEL_GATEWAY_API_KEY = 'fixture';
    process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'text-model';
    process.env.MODEL_GATEWAY_IMAGE_MODEL = 'image-model';

    expect(isImageGenerationConfigured()).toBe(true);
  });
});
