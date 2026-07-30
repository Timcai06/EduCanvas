import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { LocalObjectStorage } from '@educanvas/agent-runtime';

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

let assetStorage: Promise<LocalObjectStorage> | null = null;

/** Worker 的 Asset 与派生对象必须共用 Web 上传和删除 Outbox 使用的存储根。 */
export function getAssetTaskStorage(): Promise<LocalObjectStorage> {
  assetStorage ??= (async () => {
    const root = process.env.ASSET_STORAGE_ROOT
      ? path.resolve(process.env.ASSET_STORAGE_ROOT)
      : path.join(await findWorkspaceRoot(), 'uploads');
    return new LocalObjectStorage(root);
  })();
  return assetStorage;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
