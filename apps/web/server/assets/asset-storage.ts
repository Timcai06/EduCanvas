import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function findWorkspaceRoot(): Promise<string> {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      await access(path.join(current, 'pnpm-workspace.yaml'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('workspace_root_not_found');
}

async function storageRoot(): Promise<string> {
  if (process.env.ASSET_STORAGE_ROOT) {
    return path.resolve(process.env.ASSET_STORAGE_ROOT);
  }
  return path.join(await findWorkspaceRoot(), 'uploads');
}

async function resolveStorageKey(storageKey: string): Promise<string> {
  const root = await storageRoot();
  const absolutePath = path.join(root, ...storageKey.split('/'));
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('asset_storage_path_invalid');
  }
  return absolutePath;
}

export interface StoredAssetObject {
  storageKey: string;
  absolutePath: string;
}

/** 本地开发对象存储适配器；公开契约和数据库都只保存随机 storageKey。 */
export async function storeAssetBytes(input: {
  ownerSubjectId: string;
  bytes: Uint8Array;
  extension: string;
}): Promise<StoredAssetObject> {
  const ownerPartition = createHash('sha256')
    .update(input.ownerSubjectId, 'utf8')
    .digest('hex')
    .slice(0, 16);
  const safeExtension = input.extension
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  if (!safeExtension) throw new Error('asset_extension_invalid');
  const storageKey = `assets/${ownerPartition}/${randomUUID()}.${safeExtension}`;
  const absolutePath = await resolveStorageKey(storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.bytes, { flag: 'wx', mode: 0o600 });
  return { storageKey, absolutePath };
}

export async function readStoredAssetBytes(
  storageKey: string,
): Promise<Buffer> {
  if (!/^assets\/[a-f0-9]{16}\/[0-9a-f-]+\.[a-z0-9]+$/.test(storageKey)) {
    throw new Error('asset_storage_key_invalid');
  }
  return readFile(await resolveStorageKey(storageKey));
}

export async function removeStoredAsset(
  stored: StoredAssetObject,
): Promise<void> {
  await rm(stored.absolutePath, { force: true });
}

/** 仅删除通过受控 storageKey 定位的私有对象；调用方不得传入任意文件路径。 */
export async function removeStoredAssetByKey(
  storageKey: string,
): Promise<void> {
  if (!/^assets\/[a-f0-9]{16}\/[0-9a-f-]+\.[a-z0-9]+$/.test(storageKey)) {
    throw new Error('asset_storage_key_invalid');
  }
  await rm(await resolveStorageKey(storageKey), { force: true });
}
