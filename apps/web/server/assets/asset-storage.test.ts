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

  it('拒绝未登记前缀和路径穿越', async () => {
    await expect(
      readStoredAssetBytes('derived/unknown/job/file.txt'),
    ).rejects.toThrow('asset_storage_key_invalid');
    await expect(readStoredAssetBytes('../outside.txt')).rejects.toThrow(
      'asset_storage_key_invalid',
    );
  });
});
