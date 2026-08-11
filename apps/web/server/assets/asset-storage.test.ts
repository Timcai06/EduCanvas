import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readStoredAssetBytes } from './asset-storage';

describe('asset storage controlled reads', () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'educanvas-assets-'));
    process.env.ASSET_STORAGE_ROOT = storageRoot;
  });

  afterEach(async () => {
    delete process.env.ASSET_STORAGE_ROOT;
    await rm(storageRoot, { force: true, recursive: true });
  });

  it('读取 Worker 生成的 derived transcription 对象', async () => {
    const storageKey = `derived/transcription/44444444-4444-4444-8444-444444444444/${'a'.repeat(64)}.txt`;
    const absolutePath = path.join(storageRoot, ...storageKey.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, '派生转录文本');

    await expect(readStoredAssetBytes(storageKey)).resolves.toEqual(
      Buffer.from('派生转录文本'),
    );
  });

  it('读取 MinerU 结构化布局 derived/<jobId>/index.md（ADR-0026 决定 3）', async () => {
    const storageKey = 'derived/11111111-1111-4111-8111-111111111111/index.md';
    const absolutePath = path.join(storageRoot, ...storageKey.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, '# 结构化标题');

    await expect(readStoredAssetBytes(storageKey)).resolves.toEqual(
      Buffer.from('# 结构化标题'),
    );
  });

  it('读取 MinerU 布局的 manifest.json 与 images/ 子目录对象', async () => {
    for (const key of [
      'derived/11111111-1111-4111-8111-111111111111/manifest.json',
      'derived/11111111-1111-4111-8111-111111111111/images/001.jpg',
    ]) {
      const absolutePath = path.join(storageRoot, ...key.split('/'));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, 'x');
    }

    await expect(
      readStoredAssetBytes(
        'derived/11111111-1111-4111-8111-111111111111/manifest.json',
      ),
    ).resolves.toEqual(Buffer.from('x'));
    await expect(
      readStoredAssetBytes(
        'derived/11111111-1111-4111-8111-111111111111/images/001.jpg',
      ),
    ).resolves.toEqual(Buffer.from('x'));
  });

  it('拒绝未登记前缀和路径穿越', async () => {
    await expect(
      readStoredAssetBytes('derived/unknown/job/file.txt'),
    ).rejects.toThrow('asset_storage_key_invalid');
    await expect(readStoredAssetBytes('../outside.txt')).rejects.toThrow(
      'asset_storage_key_invalid',
    );
    /* jobId 段必须是 UUID 或 kind 枚举，路径穿越进不了第一段。 */
    await expect(
      readStoredAssetBytes('derived/../secret/file.txt'),
    ).rejects.toThrow('asset_storage_key_invalid');
  });
});
