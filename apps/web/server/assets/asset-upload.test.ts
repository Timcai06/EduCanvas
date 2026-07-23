import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const drizzleRepo = {
  createUploaded: vi.fn(),
  listOwnedSpace: vi.fn(),
};

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzleAssetRepository: vi.fn(() => drizzleRepo),
  };
});
vi.mock('@/server/teaching/learning-session', () => ({
  loadOwnedTeachingSession: vi.fn(),
}));
vi.mock('@/server/assets/asset-storage', () => ({
  storeAssetBytes: vi.fn(),
  removeStoredAsset: vi.fn(),
}));
vi.mock('unpdf', () => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

import { loadOwnedTeachingSession } from '@/server/teaching/learning-session';
import { removeStoredAsset, storeAssetBytes } from './asset-storage';
import { uploadOwnedAsset } from './asset-upload';
import { extractText, getDocumentProxy } from 'unpdf';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'d'.repeat(64)}`,
};

function bytesFile(
  bytes: readonly number[],
  name: string,
  type: string,
): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function snapshot(id: string, displayName = 'note.pdf') {
  return {
    descriptor: {
      assetId: id,
      scope: 'space',
      kind: 'document',
      origin: 'upload',
      displayName,
      mimeType: 'application/pdf',
      status: 'ready',
      currentVersionId: `${id}-v1`,
    },
    version: {
      assetId: id,
      versionId: `${id}-v1`,
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 4,
      contentHash: 'a'.repeat(64),
      status: 'ready',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('uploadOwnedAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drizzleRepo.createUploaded.mockReset();
    drizzleRepo.listOwnedSpace.mockReset();
    (loadOwnedTeachingSession as ReturnType<
      typeof vi.fn
    >).mockReset?.();
    (storeAssetBytes as ReturnType<typeof vi.fn>).mockReset?.();
    (removeStoredAsset as ReturnType<typeof vi.fn>).mockReset?.();
    (extractText as ReturnType<typeof vi.fn>).mockReset?.();
    (getDocumentProxy as ReturnType<typeof vi.fn>).mockReset?.();

    (loadOwnedTeachingSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'space-1',
    });
    drizzleRepo.createUploaded.mockResolvedValue(snapshot('asset-1'));
    storeAssetBytes.mockResolvedValue({
      storageKey: 'assets/a',
      absolutePath: '/tmp/assets/a',
    });
    getDocumentProxy.mockResolvedValue({});
  });

  it('upload成功后返回持久化快照并写入解析文本', async () => {
    extractText.mockResolvedValue(' 课程资料   ');

    const result = await uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x25, 0x50, 0x44, 0x46, 0x2d],
        'note.pdf',
        'application/pdf',
      ),
      scope: 'space',
    });

    expect(result).toMatchObject({ descriptor: { assetId: 'asset-1' } });
    expect(drizzleRepo.createUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerSubjectId: identity.studentId,
        spaceId: 'space-1',
        scope: 'space',
        kind: 'document',
        mimeType: 'application/pdf',
        extractedText: '课程资料',
      }),
    );
  });

  it('没有教学会话时直接返回会话未找到错误', async () => {
    (
      loadOwnedTeachingSession as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x25, 0x50, 0x44, 0x46],
        'note.pdf',
        'application/pdf',
      ),
      scope: 'space',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'session_not_found',
      status: 404,
    });
  });

  it('非法字节流会拒绝上传', async () => {
    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile([0x00, 0x11, 0x22], 'note.bin', 'application/octet-stream'),
      scope: 'space',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'unsupported_file_type',
      status: 415,
    });
  });

  it('0字节文件返回invalid_upload', async () => {
    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile([], 'note.pdf', 'application/pdf'),
      scope: 'space',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'invalid_upload',
      status: 400,
    });
  });

  it('pdf解析失败会记录失败版本并返回pdf_text_unavailable', async () => {
    const pdf = bytesFile(
      [0x25, 0x50, 0x44, 0x46, 0x2d],
      'note.pdf',
      'application/pdf',
    );
    extractText.mockResolvedValue('   ');

    const result = uploadOwnedAsset({
      identity,
      file: pdf,
      scope: 'space',
    });

    await expect(result).rejects.toMatchObject({
      code: 'pdf_text_unavailable',
      status: 422,
    });
    expect(drizzleRepo.createUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(removeStoredAsset).not.toHaveBeenCalled();
  });

  it('持久化失败时会清理已落地对象', async () => {
    drizzleRepo.createUploaded.mockRejectedValue(new Error('db down'));

    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x25, 0x50, 0x44, 0x46, 0x2d],
        'note.pdf',
        'application/pdf',
      ),
      scope: 'space',
    });
    extractText.mockResolvedValue('正文');

    await expect(promise).rejects.toThrow('db down');
    expect(removeStoredAsset).toHaveBeenCalledWith({
      storageKey: 'assets/a',
      absolutePath: '/tmp/assets/a',
    });
  });
});
