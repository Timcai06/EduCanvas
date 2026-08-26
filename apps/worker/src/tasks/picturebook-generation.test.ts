import { createHash } from 'node:crypto';
import type {
  ImageGenerationModelGateway,
  StructuredModelGateway,
} from '@educanvas/agent-core';
import type {
  DrizzlePlatformArtifactRepository,
  PlatformArtifact,
  PlatformArtifactJob,
} from '@educanvas/db';
import { describe, expect, it, vi } from 'vitest';
import { appendPicturebookVersion } from './picturebook-generation';

const artifact = {
  id: '11111111-1111-4111-8111-111111111111',
  spaceId: '22222222-2222-4222-8222-222222222222',
  conversationId: '33333333-3333-4333-8333-333333333333',
  ownerSubjectId: 'student-1',
  kind: 'picturebook',
  trustTier: 'tier2',
  title: '小狐狸认识平均数',
  status: 'proposed',
  latestVersion: 0,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
} satisfies PlatformArtifact;

const job = {
  id: '44444444-4444-4444-8444-444444444444',
  artifactId: artifact.id,
  operationId: '55555555-5555-4555-8555-555555555555',
  status: 'running',
  progress: 5,
  failureCode: null,
  params: { generation: { instruction: '用平均数讲一个故事' } },
  checkpoint: {},
  queueJobKey: null,
} satisfies PlatformArtifactJob;

function checksum(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('appendPicturebookVersion', () => {
  it('先分页再逐页调用同一图片边界，并只持久化一个 bundle', async () => {
    const plan = {
      pages: Array.from({ length: 6 }, (_, index) => ({
        imagePrompt: `same fox page ${index + 1}`,
        captionText: `第 ${index + 1} 页`,
      })),
    };
    const structured = {
      generateStructured: vi.fn().mockResolvedValue({ output: plan }),
    } as unknown as StructuredModelGateway;
    const image = {
      generateImage: vi.fn().mockResolvedValue({
        images: [
          {
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: 'image/png',
            size: '512x512',
          },
        ],
        metadata: {
          provider: 'fixture-image',
          resolvedModelId: 'fixture-v1',
          latencyMs: 12,
        },
      }),
    } as unknown as ImageGenerationModelGateway;
    const objects = new Map<string, Uint8Array>();
    const storage = {
      put: vi.fn(async ({ key, bytes }: { key: string; bytes: Uint8Array }) => {
        objects.set(key, bytes);
        return { key, checksum: checksum(bytes), sizeBytes: bytes.byteLength };
      }),
      readVerified: vi.fn(async (key: string, expected: string) => {
        const bytes = objects.get(key)!;
        expect(checksum(bytes)).toBe(expected);
        return bytes;
      }),
      delete: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    };
    const updateCheckpoint = vi.fn().mockResolvedValue(undefined);
    const appendVersion = vi.fn().mockResolvedValue({ version: 1 });
    const repository = {
      updateGenerationJobCheckpoint: updateCheckpoint,
      appendVersionAndCompleteGenerationJob: appendVersion,
    } as unknown as DrizzlePlatformArtifactRepository;

    await appendPicturebookVersion({
      artifact,
      job,
      subjectId: 'student-1',
      artifacts: repository,
      structuredGateway: structured,
      imageGateway: image,
      messages: [{ role: 'user', content: '请解释平均数' }],
      instruction: '用平均数讲一个故事',
      storage,
    });

    expect(structured.generateStructured).toHaveBeenCalledTimes(1);
    expect(image.generateImage).toHaveBeenCalledTimes(6);
    expect(image.generateImage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ size: '512x512', count: 1 }),
    );
    expect(storage.put).toHaveBeenCalledTimes(1);
    const storedBundle = JSON.parse(
      new TextDecoder().decode([...objects.values()][0]),
    );
    expect(storedBundle.pages).toHaveLength(6);
    expect(updateCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: expect.objectContaining({ kind: 'picturebook' }),
      }),
    );
    expect(appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringContaining('/picturebook.json'),
      }),
    );
    expect(appendVersion.mock.calls[0]![0]).not.toHaveProperty('content');
  });

  it('没有图片 Provider 时诚实失败', async () => {
    await expect(
      appendPicturebookVersion({
        artifact,
        job,
        subjectId: 'student-1',
        artifacts: {} as DrizzlePlatformArtifactRepository,
        structuredGateway: {} as StructuredModelGateway,
        imageGateway: null,
        messages: [],
        instruction: '生成绘本',
      }),
    ).rejects.toMatchObject({
      code: 'image_not_configured',
    });
  });
});
