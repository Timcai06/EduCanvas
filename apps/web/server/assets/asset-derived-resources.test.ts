import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { loadOwnedTextRepresentation } = vi.hoisted(() => ({
  loadOwnedTextRepresentation: vi.fn(),
}));
vi.mock('@educanvas/db', () => ({
  AssetAccessError: class AssetAccessError extends Error {},
  DrizzleAssetRepository: vi.fn(function () {
    return { loadOwnedTextRepresentation };
  }),
}));

const { readStoredAssetBytes } = vi.hoisted(() => ({
  readStoredAssetBytes: vi.fn(),
}));
vi.mock('./asset-storage', () => ({ readStoredAssetBytes }));

import { AssetAccessError } from '@educanvas/db';
import {
  AssetResourceError,
  readOwnedAssetResource,
} from './asset-derived-resources';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const identity = { token: 'token', studentId: 'owner-1' };
const MD_BYTES = Buffer.from('# 标题\n\n正文。');
const MD_SHA = createHash('sha256').update(MD_BYTES).digest('hex');
const IMG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const IMG_SHA = createHash('sha256').update(IMG_BYTES).digest('hex');

const manifest = {
  schemaVersion: 1,
  producer: 'mineru',
  markdown: {
    relativePath: 'index.md',
    sha256: MD_SHA,
    byteSize: MD_BYTES.byteLength,
    mimeType: 'text/markdown',
  },
  images: [
    {
      relativePath: 'images/001.jpg',
      sha256: IMG_SHA,
      byteSize: IMG_BYTES.byteLength,
      mimeType: 'image/jpeg',
      position: 0,
    },
  ],
};

function structuredRepresentation() {
  return {
    derivedStorageKey: `derived/${JOB_ID}/index.md`,
    checksum: 'a'.repeat(64),
    status: 'ready' as const,
    quality: 'structured' as const,
    mimeType: 'text/markdown',
  };
}

function storageByKey(key: string): Buffer {
  if (key.endsWith('/manifest.json')) {
    return Buffer.from(JSON.stringify(manifest));
  }
  if (key.endsWith('/index.md')) return MD_BYTES;
  if (key.endsWith('/images/001.jpg')) return IMG_BYTES;
  throw new Error('asset_object_missing');
}

function run(resourcePath: string) {
  return readOwnedAssetResource({
    identity,
    spaceId: '20000000-0000-4000-8000-000000000002',
    assetId: '30000000-0000-4000-8000-000000000003',
    resourcePath,
  });
}

describe('readOwnedAssetResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOwnedTextRepresentation.mockResolvedValue(structuredRepresentation());
    readStoredAssetBytes.mockImplementation(storageByKey);
  });

  it('返回 manifest 声明的 index.md 字节与 markdown MIME', async () => {
    const resource = await run('index.md');

    expect(resource.bytes).toEqual(MD_BYTES);
    expect(resource.mimeType).toBe('text/markdown; charset=utf-8');
  });

  it('返回 manifest 声明的 images/ 对象字节与白名单 MIME', async () => {
    const resource = await run('images/001.jpg');

    expect(resource.bytes).toEqual(IMG_BYTES);
    expect(resource.mimeType).toBe('image/jpeg');
  });

  it('权限复验失败统一按资源不存在 404（ADR-0026 决定 3 复验）', async () => {
    loadOwnedTextRepresentation.mockRejectedValue(new AssetAccessError());

    await expect(run('index.md')).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });
  });

  it('无文本表示（null）按 404', async () => {
    loadOwnedTextRepresentation.mockResolvedValue(null);

    await expect(run('index.md')).rejects.toMatchObject({ status: 404 });
  });

  it.each(['degraded_plain_text', 'processing', 'failed'])(
    '质量 %s 没有派生资源，按 404',
    async (quality) => {
      loadOwnedTextRepresentation.mockResolvedValue({
        ...structuredRepresentation(),
        quality,
      });

      await expect(run('index.md')).rejects.toMatchObject({ status: 404 });
    },
  );

  it('manifest 对象缺失时按 404，不泄露内部错误', async () => {
    readStoredAssetBytes.mockImplementation((key: string) => {
      if (key.endsWith('/manifest.json')) {
        throw new Error('ENOENT');
      }
      return storageByKey(key);
    });

    await expect(run('index.md')).rejects.toMatchObject({ status: 404 });
  });

  it('manifest JSON 损坏时按 404', async () => {
    readStoredAssetBytes.mockImplementation((key: string) => {
      if (key.endsWith('/manifest.json')) {
        return Buffer.from('not json {');
      }
      return storageByKey(key);
    });

    await expect(run('index.md')).rejects.toMatchObject({ status: 404 });
  });

  it('manifest 未声明的路径（含 ../ 穿越尝试）按 404', async () => {
    await expect(run('other.md')).rejects.toMatchObject({ status: 404 });
    await expect(run('../manifest.json')).rejects.toMatchObject({
      status: 404,
    });
    await expect(run('images/gone.jpg')).rejects.toMatchObject({ status: 404 });
  });

  it('对象字节数与 manifest 声明不一致按 404（完整性防御）', async () => {
    readStoredAssetBytes.mockImplementation((key: string) => {
      if (key.endsWith('/index.md')) {
        return Buffer.concat([MD_BYTES, Buffer.from('多出来')]);
      }
      return storageByKey(key);
    });

    await expect(run('index.md')).rejects.toMatchObject({ status: 404 });
  });

  it('对象 sha256 与 manifest 声明不一致按 404（完整性防御）', async () => {
    readStoredAssetBytes.mockImplementation((key: string) => {
      if (key.endsWith('/images/001.jpg')) {
        return Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00]);
      }
      return storageByKey(key);
    });

    await expect(run('images/001.jpg')).rejects.toMatchObject({ status: 404 });
  });

  it('表示对象不是 index.md 结尾（未知布局）按 503', async () => {
    loadOwnedTextRepresentation.mockResolvedValue({
      ...structuredRepresentation(),
      derivedStorageKey: `derived/${JOB_ID}/other.md`,
    });

    await expect(run('other.md')).rejects.toMatchObject({
      code: 'resource_unavailable',
      status: 503,
    });
  });

  it('抛出的错误类型是 AssetResourceError（路由可识别）', async () => {
    await expect(run('index.md')).resolves.toBeDefined();
    try {
      await run('nope.md');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AssetResourceError);
    }
  });
});
