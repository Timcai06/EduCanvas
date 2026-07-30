import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, storage, generate } = vi.hoisted(() => ({
  repo: {
    beginThumbnailGenerationAttempt: vi.fn(),
    settleThumbnailGeneration: vi.fn(),
  },
  storage: {
    readVerified: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  generate: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  DrizzleAssetDerivedProcessingRepository: vi.fn(function () {
    return repo;
  }),
}));

vi.mock('./asset-task-storage.js', () => ({
  getAssetTaskStorage: vi.fn(async () => storage),
  sha256Hex: vi.fn(() => 'd'.repeat(64)),
}));

vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return { ...actual, generateThumbnail: generate };
});

import { AssetThumbnailError } from '@educanvas/asset-processing';
import { generateThumbnailTask } from './generate-thumbnail';

const JOB_ID = '22222222-2222-4222-8222-222222222222';
const pending = {
  storageKey: 'assets/source.png',
  mimeType: 'image/png',
  byteSize: 4,
  contentHash: 'e'.repeat(64),
};

function run(attempts = 1, maxAttempts = 3) {
  return generateThumbnailTask({ jobId: JOB_ID }, {
    job: { attempts, max_attempts: maxAttempts },
  } as never);
}

describe('assets:generate_thumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.beginThumbnailGenerationAttempt.mockResolvedValue(pending);
    repo.settleThumbnailGeneration.mockResolvedValue(true);
    storage.readVerified.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    storage.put.mockResolvedValue({
      key: `derived/thumbnail/${JOB_ID}/dddddddddddddddd.jpg`,
      checksum: 'f'.repeat(64),
      sizeBytes: 12,
    });
    generate.mockResolvedValue({
      bytes: new Uint8Array([5, 6, 7]),
      mimeType: 'image/jpeg',
      width: 3,
      height: 2,
    });
  });

  it('成功生成并结算 JPEG 缩略图', async () => {
    await run();

    expect(storage.readVerified).toHaveBeenCalledWith(
      pending.storageKey,
      pending.contentHash,
    );
    expect(repo.settleThumbnailGeneration).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        derivedStorageKey: `derived/thumbnail/${JOB_ID}/dddddddddddddddd.jpg`,
        checksum: 'f'.repeat(64),
        byteSize: 12,
      },
    });
  });

  it('未知 MIME 与大小超限诚实失败', async () => {
    repo.beginThumbnailGenerationAttempt.mockResolvedValueOnce({
      ...pending,
      mimeType: 'application/pdf',
    });
    await run();
    expect(repo.settleThumbnailGeneration).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'unsupported_media_type' },
    });

    repo.beginThumbnailGenerationAttempt.mockResolvedValueOnce({
      ...pending,
      byteSize: 10 * 1024 * 1024 + 1,
    });
    await run();
    expect(repo.settleThumbnailGeneration).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'thumbnail_input_too_large' },
    });
    expect(storage.readVerified).not.toHaveBeenCalled();
  });

  it('损坏图片写稳定失败码', async () => {
    generate.mockRejectedValue(
      new AssetThumbnailError('image_processing_failed', {
        cause: new Error('/private/image.png'),
      }),
    );

    await run();

    expect(repo.settleThumbnailGeneration).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'image_processing_failed' },
    });
  });

  it('瞬时异常重试，最终耗尽后收敛', async () => {
    storage.readVerified.mockRejectedValue(new Error('temporary storage'));

    await expect(run()).rejects.toThrow('temporary storage');
    expect(repo.settleThumbnailGeneration).not.toHaveBeenCalled();

    await run(3, 3);
    expect(repo.settleThumbnailGeneration).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'failed',
        failureCode: 'asset_processing_exhausted',
      },
    });
  });

  it('重复投递已经终结时不读取，失效结算时清理派生对象', async () => {
    repo.beginThumbnailGenerationAttempt.mockResolvedValueOnce(null);
    await run();
    expect(storage.readVerified).not.toHaveBeenCalled();

    repo.beginThumbnailGenerationAttempt.mockResolvedValueOnce(pending);
    repo.settleThumbnailGeneration.mockResolvedValue(false);
    await run();
    expect(storage.delete).toHaveBeenCalledWith(
      `derived/thumbnail/${JOB_ID}/dddddddddddddddd.jpg`,
    );
  });
});
