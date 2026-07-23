import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectStorageError } from '@educanvas/agent-core';
import { LocalObjectStorage } from './local-object-storage';

describe('LocalObjectStorage', () => {
  let root = '';
  let storage: LocalObjectStorage;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'educanvas-objects-'));
    storage = new LocalObjectStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('写入返回 sha-256 校验和,读取往返一致', async () => {
    const bytes = new TextEncoder().encode('audio-bytes-α');
    const stored = await storage.put({ key: 'artifacts/a/b.mp3', bytes });
    expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.sizeBytes).toBe(bytes.byteLength);

    const readBack = await storage.readVerified(
      'artifacts/a/b.mp3',
      stored.checksum,
    );
    expect(new TextDecoder().decode(readBack)).toBe('audio-bytes-α');
  });

  it('同 key 覆盖写幂等,校验和随内容更新', async () => {
    const first = await storage.put({
      key: 'artifacts/v.txt',
      bytes: new TextEncoder().encode('v1'),
    });
    const second = await storage.put({
      key: 'artifacts/v.txt',
      bytes: new TextEncoder().encode('v2'),
    });
    expect(second.checksum).not.toBe(first.checksum);
    expect(
      new TextDecoder().decode(await storage.read('artifacts/v.txt')),
    ).toBe('v2');
  });

  it('损坏对象以 checksum_mismatch 失败,不返回坏字节', async () => {
    const stored = await storage.put({
      key: 'artifacts/c.bin',
      bytes: new TextEncoder().encode('original'),
    });
    await writeFile(path.join(root, 'artifacts/c.bin'), 'tampered');
    await expect(
      storage.readVerified('artifacts/c.bin', stored.checksum),
    ).rejects.toMatchObject({ code: 'checksum_mismatch' });
  });

  it('非法 key 与不存在对象有稳定错误码', async () => {
    await expect(
      storage.put({ key: '../escape', bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: 'invalid_key' });
    await expect(storage.read('artifacts/missing.bin')).rejects.toMatchObject({
      code: 'object_not_found',
    });
    await expect(storage.read('artifacts/missing.bin')).rejects.toBeInstanceOf(
      ObjectStorageError,
    );
  });
});
