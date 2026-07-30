import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { mindMapContentSchema } from '@educanvas/canvas-protocol';
import { buildConversationOutline } from './mind-map-outline';
import { generateArtifact } from './generate-artifact';

const {
  repository,
  turnsRepository,
  appendGeneratedImageVersion,
  ImageArtifactGenerationFailure,
  resolveImageGateway,
  artifactGateway,
  ArtifactJobLifecycleError,
} = vi.hoisted(() => ({
  repository: {
    transitionGenerationJob: vi.fn(),
    getArtifact: vi.fn(),
    findVersionByGenerationJob: vi.fn(),
    getGenerationJob: vi.fn(),
    appendVersion: vi.fn(),
    appendVersionAndCompleteGenerationJob: vi.fn(),
  },
  turnsRepository: {
    listMessages: vi.fn(),
  },
  appendGeneratedImageVersion: vi.fn(),
  ImageArtifactGenerationFailure: class ArtifactImageFailure extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.name = 'ImageArtifactGenerationFailure';
      this.code = code;
    }
  },
  resolveImageGateway: vi.fn(),
  artifactGateway: {},
  ArtifactJobLifecycleError: class ArtifactJobLifecycleError extends Error {
    constructor(from: string, to: string) {
      super(`artifact transition ${from} => ${to}`);
      this.name = 'ArtifactJobLifecycleError';
    }
  },
}));

vi.mock('@educanvas/db', () => ({
  ArtifactJobLifecycleError,
  AssetAccessError: class AssetAccessError extends Error {
    constructor() {
      super('asset access denied');
      this.name = 'AssetAccessError';
    }
  },
  DrizzleAssetRepository: vi.fn(function () {
    return artifactGateway;
  }),
  DrizzlePlatformArtifactRepository: vi.fn(function () {
    return repository;
  }),
  DrizzlePlatformTurnRepository: vi.fn(function () {
    return turnsRepository;
  }),
}));

vi.mock('../model-runtime.js', () => ({
  resolveImageGenerationModelGateway: resolveImageGateway,
  resolveSpeechModelGateway: vi.fn(),
  resolveStructuredModelGateway: vi.fn(),
}));

vi.mock('./image-artifact-generation.js', () => ({
  appendGeneratedImageVersion,
  IMAGE_GENERATOR: 'model:image.generate:canvas-image-v1',
  ImageArtifactGenerationFailure,
}));

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const SUBJECT_ID = 'student-1';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const SPACE_ID = '44444444-4444-4444-9444-444444444444';

const artifactBase = {
  id: ARTIFACT_ID,
  spaceId: SPACE_ID,
  conversationId: CONVERSATION_ID,
  ownerSubjectId: SUBJECT_ID,
  kind: 'generated_image' as const,
  trustTier: 'tier2' as const,
  title: '测试产物',
  status: 'active' as const,
  latestVersion: 0,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:01:00.000Z',
};

function runTask(
  attempts = 1,
  maxAttempts = 3,
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
) {
  return generateArtifact(
    {
      jobId: JOB_ID,
      artifactId: ARTIFACT_ID,
      subjectId: SUBJECT_ID,
    },
    {
      job: { attempts, max_attempts: maxAttempts },
      logger,
    } as never,
  );
}

describe('buildConversationOutline', () => {
  it('空对话生成仅含根节点的合法导图', () => {
    const content = buildConversationOutline('AI 通识', []);
    expect(content.root.label).toBe('AI 通识');
    expect(content.root.children).toBeUndefined();
    expect(mindMapContentSchema.safeParse(content).success).toBe(true);
  });

  it('学生问题成为一级分支,回答首行与标题成为二级', () => {
    const content = buildConversationOutline('猫狗分类', [
      { role: 'user', content: '什么是神经网络?' },
      {
        role: 'assistant',
        content: '神经网络是…\n## 神经元\n内容\n## 层级结构\n内容',
      },
    ]);
    const branch = content.root.children?.[0];
    expect(branch?.label).toBe('什么是神经网络?');
    expect(branch?.children?.map((node) => node.label)).toEqual([
      '神经网络是…',
      '神经元',
      '层级结构',
    ]);
  });
});

describe('generateArtifact 媒体任务终态与重试证据', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.transitionGenerationJob.mockImplementation(
      async (input: {
        to: string;
        failureCode?: string | null;
        progress?: number | null;
      }) => ({
        id: JOB_ID,
        artifactId: ARTIFACT_ID,
        operationId: null,
        status: input.to,
        progress: input.progress ?? null,
        failureCode: input.to === 'failed' ? (input.failureCode ?? null) : null,
        params: { image: { prompt: '测试', size: '1024x1024' } },
        checkpoint: {},
        queueJobKey: 'artifact-generate',
      }),
    );
    repository.getArtifact.mockResolvedValue({
      ...artifactBase,
      latestVersion: 0,
    });
    repository.findVersionByGenerationJob.mockResolvedValue(null);
    repository.getGenerationJob.mockResolvedValue({
      id: JOB_ID,
      artifactId: ARTIFACT_ID,
      operationId: null,
      status: 'running',
      progress: 5,
      failureCode: null,
      params: { image: { prompt: '测试', size: '1024x1024' } },
      checkpoint: {},
      queueJobKey: 'artifact-generate',
    });
    appendGeneratedImageVersion.mockResolvedValue({
      id: 'v1',
      artifactId: ARTIFACT_ID,
      version: 1,
      content: null,
      metadata: {},
      objectKey: 'artifacts/1',
      checksum: 'a'.repeat(64),
      createdByOperationId: null,
      generatedBy: 'model:image.generate:canvas-image-v1',
      generationJobId: JOB_ID,
      createdAt: '2026-07-27T00:02:00.000Z',
    });
    repository.appendVersionAndCompleteGenerationJob.mockResolvedValue({
      id: 'v1',
      artifactId: ARTIFACT_ID,
      version: 1,
      content: null,
      metadata: {},
      objectKey: 'artifacts/1',
      checksum: 'a'.repeat(64),
      createdByOperationId: null,
      generatedBy: 'model:image.generate:canvas-image-v1',
      generationJobId: JOB_ID,
      createdAt: '2026-07-27T00:02:00.000Z',
    });
    turnsRepository.listMessages.mockResolvedValue([]);
  });

  it('已存在版本的已运行任务直接收敛到成功，不重复计费', async () => {
    repository.findVersionByGenerationJob.mockResolvedValue({
      id: 'v1',
      artifactId: ARTIFACT_ID,
      version: 1,
      content: null,
      metadata: {},
      objectKey: 'artifacts/1',
      checksum: 'a'.repeat(64),
      createdByOperationId: null,
      generatedBy: 'model:image.generate:canvas-image-v1',
      generationJobId: JOB_ID,
      createdAt: '2026-07-27T00:02:00.000Z',
    });

    await runTask();

    expect(repository.transitionGenerationJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ jobId: JOB_ID, to: 'running', progress: 5 }),
    );
    expect(repository.transitionGenerationJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobId: JOB_ID,
        to: 'succeeded',
        progress: 100,
      }),
    );
    expect(appendGeneratedImageVersion).not.toHaveBeenCalled();
    expect(repository.getGenerationJob).not.toHaveBeenCalled();
  });

  it('媒体 helper 已原子提交版本与成功终态，外层不再二次追加', async () => {
    await runTask();

    expect(appendGeneratedImageVersion).toHaveBeenCalledTimes(1);
    expect(
      repository.appendVersionAndCompleteGenerationJob,
    ).not.toHaveBeenCalled();
    expect(repository.transitionGenerationJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'succeeded' }),
    );
  });

  it('终态重放不再执行，不重复写版本', async () => {
    repository.transitionGenerationJob.mockRejectedValueOnce(
      new ArtifactJobLifecycleError('succeeded', 'running'),
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await runTask(1, 3, logger);

    expect(repository.transitionGenerationJob).toHaveBeenCalledTimes(1);
    expect(repository.transitionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, to: 'running' }),
    );
    expect(appendGeneratedImageVersion).not.toHaveBeenCalled();
    expect(repository.getArtifact).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('可重试 Provider 错误在重试窗口内回退 graphile，不提前落账', async () => {
    appendGeneratedImageVersion.mockRejectedValueOnce(
      new ModelGatewayInvocationError({
        code: 'rate_limit',
        retryable: true,
      }),
    );

    await expect(runTask(1, 3)).rejects.toMatchObject({
      normalized: { code: 'rate_limit', retryable: true },
    });
    expect(repository.transitionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'running' }),
    );
    expect(repository.transitionGenerationJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'failed' }),
    );
  });

  it('可重试错误在重试耗尽后落 model_attempts_exhausted', async () => {
    appendGeneratedImageVersion.mockRejectedValueOnce(
      new ModelGatewayInvocationError({
        code: 'rate_limit',
        retryable: true,
      }),
    );
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await runTask(3, 3, logger);

    expect(repository.transitionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        to: 'failed',
        failureCode: 'model_attempts_exhausted',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('model_attempts_exhausted'),
    );
  });

  it('非重试模型错误记账稳定失败码，不产生成功版本', async () => {
    appendGeneratedImageVersion.mockRejectedValueOnce(
      new ImageArtifactGenerationFailure('image_invalid_response'),
    );

    await runTask();

    expect(repository.transitionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'failed',
        failureCode: 'image_invalid_response',
      }),
    );
    expect(appendGeneratedImageVersion).toHaveBeenCalledTimes(1);
    expect(repository.getArtifact).toHaveBeenCalled();
  });

  it('非重试 ModelGatewayInvocationError 记账 model_xxx 失败码', async () => {
    appendGeneratedImageVersion.mockRejectedValueOnce(
      new ModelGatewayInvocationError({
        code: 'output_limit',
        retryable: false,
      }),
    );
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await runTask(1, 3, logger);

    expect(repository.transitionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'failed',
        failureCode: 'model_output_limit',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('model_output_limit'),
    );
  });

  it('记录失败码时不泄露模型原始载荷与内部错误细节', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const sensitiveError = new ModelGatewayInvocationError(
      {
        code: 'invalid_response',
        retryable: false,
      },
      {
        cause: {
          prompt: 'sensitive prompt',
          providerBody: 'RAW_PROVIDER_RESPONSE',
          objectKey: 'private/object/key.mp3',
          stack: 'internal.stack.trace',
        },
      },
    );

    appendGeneratedImageVersion.mockRejectedValueOnce(sensitiveError);
    await runTask(1, 3, logger);

    const [message] = logger.error.mock.calls.at(-1) as [string];
    expect(message).toContain('model_invalid_response');
    expect(message).not.toContain('sensitive prompt');
    expect(message).not.toContain('RAW_PROVIDER_RESPONSE');
    expect(message).not.toContain('private/object/key.mp3');
    expect(message).not.toContain('internal.stack.trace');
  });

  it('非法参数直接失败，不调用 Provider', async () => {
    repository.getArtifact.mockResolvedValue({
      ...artifactBase,
      kind: 'story_book',
      status: 'active',
      latestVersion: 0,
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await runTask(1, 3, logger);

    expect(appendGeneratedImageVersion).not.toHaveBeenCalled();
    expect(repository.transitionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'failed',
        failureCode: 'unsupported_kind',
      }),
    );
  });

  it('generateArtifact 不触碰学习事实相关模块与字段', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), './generate-artifact.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/learning_?[eE]vents/);
    expect(source).not.toMatch(/[mM]astery/);
    expect(source).not.toContain('DrizzleEventStore');
    expect(source).not.toContain('teaching-runtime');
  });
});
