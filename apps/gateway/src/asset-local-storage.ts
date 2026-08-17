import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { GatewayImagePreviewError } from './asset-image-preview-service';

const ORIGINAL_IMAGE_STORAGE_KEY =
  /^assets\/[a-f0-9]{16}\/[0-9a-f-]+\.[a-z0-9]+$/;

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
  if (process.env.ASSET_STORAGE_ROOT)
    return path.resolve(process.env.ASSET_STORAGE_ROOT);
  return path.join(await findWorkspaceRoot(), 'uploads');
}

/**
 * Gateway 只读取由 canonical Message 引用的原始图片对象。路径永远由受控
 * storageKey 推导，拒绝派生对象和任意文件路径，避免把桌宠预览变成文件读取器。
 */
export async function readGatewayImageBytes(
  storageKey: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!ORIGINAL_IMAGE_STORAGE_KEY.test(storageKey)) {
    throw new Error('asset_storage_key_invalid');
  }
  const root = await storageRoot();
  const absolutePath = path.resolve(root, ...storageKey.split('/'));
  if (path.relative(root, absolutePath).startsWith(`..${path.sep}`)) {
    throw new Error('asset_storage_path_invalid');
  }
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error('asset_storage_path_not_file');
  if (metadata.size > maxBytes) {
    throw new GatewayImagePreviewError(413, 'PREVIEW_TOO_LARGE');
  }
  return readFile(absolutePath);
}
