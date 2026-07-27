import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => ({
  storage: {
    put: vi.fn(),
    readVerified: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@educanvas/agent-runtime', () => ({
  LocalObjectStorage: vi.fn(function () {
    return storage;
  }),
}));

import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import type { DrizzlePlatformArtifactRepository } from '@educanvas/db';
import {
  appendGeneratedImageVersion,
  ImageArtifactGenerationFailure,
  IMAGE_GENERATOR,
} from './image-artifact-generation';

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const SUBJECT_ID = 'student-1';
const CHECKSUM = 'a'.repeat(64);
const OBJECT_KEY = `artifacts/${ARTIFACT_ID}/jobs/${JOB_ID}/image.png`;

const artifact = {
  id: ARTIFACT_ID,
  spaceId: 'notebook-1',
  conversationId: 'conversation-1',
  ownerSubjectId: SUBJECT_ID,
  kind: 'generated_image',
  trustTier: 'tier2' as const,
  title: '光合作用示意图',
  status: 'proposed' as const,
  latestVersion: 0,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

function createJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    artifactId: ARTIFACT_ID,
    status: 'running' as const,
    progress: 5,
    failureCode: null,
    params: { image: { prompt: '画一张光合作用示意图', size: '1024x1024' } },
    checkpoint: {},
    queueJobKey: `artifact-generate:${ARTIFACT_ID}`,
    ...overrides,
  };
}

function createRepository() {
  return {
    appendVersion: vi.fn().mockResolvedValue({ version: 1 }),
    updateGenerationJobCheckpoint: vi.fn().mockResolvedValue(undefined),
  } as unknown as DrizzlePlatformArtifactRepository & {
    appendVersion: ReturnType<typeof vi.fn>;
    updateGenerationJobCheckpoint: ReturnType<typeof vi.fn>;
  };
}

function createGateway() {
  return {
    generateImage: vi.fn().mockResolvedValue({
      images: [
        {
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          mimeType: 'image/png' as const,
          size: '1024x1024' as const,
        },
      ],
      metadata: {
        provider: 'openai-compatible',
        resolvedModelId: 'image-v1',
        latencyMs: 120,
        traceId: `artifact:${ARTIFACT_ID}:image`,
      },
    }),
  };
}

describe('appendGeneratedImageVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.put.mockResolvedValue({
      key: OBJECT_KEY,
      checksum: CHECKSUM,
      sizeBytes: 4,
    });
    storage.readVerified.mockResolvedValue(new Uint8Array(4));
    storage.delete.mockResolvedValue(undefined);
  });

  it('生成成功后写入对象存储与不可变版本，元数据不含 objectKey/checksum', async () => {
    const artifacts = createRepository();
    const gateway = createGateway();

    await appendGeneratedImageVersion({
      artifact,
      job: createJob(),
      subjectId: SUBJECT_ID,
      artifacts,
      gateway,
    });

    expect(gateway.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        taskAlias: 'image.generate',
        modelAlias: 'image',
        count: 1,
        size: '1024x1024',
        prompt: '画一张光合作用示意图',
      }),
    );
    const appended = artifacts.appendVersion.mock.calls[0]![0];
    expect(appended).toMatchObject({
      artifactId: ARTIFACT_ID,
      objectKey: OBJECT_KEY,
      checksum: CHECKSUM,
      generatedBy: IMAGE_GENERATOR,
      generationJobId: JOB_ID,
    });
    expect(appended.metadata).toEqual({
      contentVersion: 1,
      contentType: 'image/png',
      byteSize: 4,
      size: '1024x1024',
      image: {
        provider: 'openai-compatible',
        resolvedModelId: 'image-v1',
        latencyMs: 120,
      },
    });
    expect(Object.keys(appended.metadata as object)).not.toContain('objectKey');
  });

  it('检查点存在时直接复用对象，不重复调用计费的生成', async () => {
    const artifacts = createRepository();
    const gateway = createGateway();
    const checkpoint = {
      kind: 'generated_image',
      objectKey: OBJECT_KEY,
      checksum: CHECKSUM,
      metadata: {
        contentVersion: 1,
        contentType: 'image/png',
        byteSize: 4,
        size: '1024x1024',
        image: {
          provider: 'openai-compatible',
          resolvedModelId: 'image-v1',
          latencyMs: 120,
        },
      },
    };

    await appendGeneratedImageVersion({
      artifact,
      job: createJob({ checkpoint }),
      subjectId: SUBJECT_ID,
      artifacts,
      gateway,
    });

    expect(gateway.generateImage).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.readVerified).toHaveBeenCalledWith(OBJECT_KEY, CHECKSUM);
    expect(artifacts.appendVersion).toHaveBeenCalledTimes(1);
  });

  it('检查点对象丢失时以稳定失败码终结，不静默重新生成', async () => {
    storage.readVerified.mockRejectedValue(new Error('missing'));

    await expect(
      appendGeneratedImageVersion({
        artifact,
        job: createJob({
          checkpoint: {
            kind: 'generated_image',
            objectKey: OBJECT_KEY,
            checksum: CHECKSUM,
            metadata: {
              contentVersion: 1,
              contentType: 'image/png',
              byteSize: 4,
              size: '1024x1024',
              image: {
                provider: 'p',
                resolvedModelId: 'm',
                latencyMs: 1,
              },
            },
          },
        }),
        subjectId: SUBJECT_ID,
        artifacts: createRepository(),
        gateway: createGateway(),
      }),
    ).rejects.toMatchObject({ code: 'image_checkpoint_invalid' });
  });

  it('未配置图像网关时诚实失败，不回退到其他模型入口', async () => {
    await expect(
      appendGeneratedImageVersion({
        artifact,
        job: createJob(),
        subjectId: SUBJECT_ID,
        artifacts: createRepository(),
        gateway: null,
      }),
    ).rejects.toMatchObject({ code: 'image_not_configured' });
  });

  it('非法任务参数不进入 Provider 调用', async () => {
    const gateway = createGateway();

    await expect(
      appendGeneratedImageVersion({
        artifact,
        job: createJob({ params: { image: { prompt: '', size: '9x9' } } }),
        subjectId: SUBJECT_ID,
        artifacts: createRepository(),
        gateway,
      }),
    ).rejects.toMatchObject({ code: 'image_params_invalid' });
    expect(gateway.generateImage).not.toHaveBeenCalled();
  });

  it('Provider 归一化错误映射为稳定失败码，不泄漏响应体', async () => {
    const gateway = createGateway();
    gateway.generateImage.mockRejectedValue(
      new ModelGatewayInvocationError({
        code: 'content_filtered',
        retryable: false,
      }),
    );

    const error = await appendGeneratedImageVersion({
      artifact,
      job: createJob(),
      subjectId: SUBJECT_ID,
      artifacts: createRepository(),
      gateway,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ImageArtifactGenerationFailure);
    expect((error as ImageArtifactGenerationFailure).code).toBe(
      'image_content_filtered',
    );
  });

  it('Provider 可重试错误保持原错误交给 Graphile 退避', async () => {
    const gateway = createGateway();
    const retryable = new ModelGatewayInvocationError({
      code: 'rate_limit',
      retryable: true,
    });
    gateway.generateImage.mockRejectedValue(retryable);

    await expect(
      appendGeneratedImageVersion({
        artifact,
        job: createJob(),
        subjectId: SUBJECT_ID,
        artifacts: createRepository(),
        gateway,
      }),
    ).rejects.toBe(retryable);
  });

  it('检查点写入失败时回收孤儿对象，避免恢复时重复计费', async () => {
    const artifacts = createRepository();
    artifacts.updateGenerationJobCheckpoint.mockRejectedValue(
      new Error('ledger_unavailable'),
    );

    await expect(
      appendGeneratedImageVersion({
        artifact,
        job: createJob(),
        subjectId: SUBJECT_ID,
        artifacts,
        gateway: createGateway(),
      }),
    ).rejects.toThrow('ledger_unavailable');
    expect(storage.delete).toHaveBeenCalledWith(OBJECT_KEY);
    expect(artifacts.appendVersion).not.toHaveBeenCalled();
  });

  it('公开元数据不保存完整 Prompt 或其摘要', async () => {
    const artifacts = createRepository();

    await appendGeneratedImageVersion({
      artifact,
      job: createJob({
        params: { image: { prompt: '🌱'.repeat(600), size: '512x512' } },
      }),
      subjectId: SUBJECT_ID,
      artifacts,
      gateway: createGateway(),
    });

    const metadata = artifacts.appendVersion.mock.calls[0]![0].metadata;
    expect(metadata).not.toHaveProperty('prompt');
    expect(metadata).not.toHaveProperty('promptSummary');
  });
});
