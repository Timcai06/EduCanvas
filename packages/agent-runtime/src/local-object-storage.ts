import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isValidObjectKey,
  ObjectStorageError,
  type ObjectStoragePort,
  type StoredObject,
} from '@educanvas/agent-core';

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
  throw new ObjectStorageError('storage_unavailable', 'workspace 根目录不可达');
}

const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * 本地文件系统对象存储适配器(ADR-0012 起步实现;S3 兼容适配器可替换)。
 * - 写入走临时文件 + rename,同分区内原子,不留半写对象;
 * - 读取重算 sha-256,与写入时返回给调用方的校验和口径一致——损坏对象
 *   必须以 checksum_mismatch 暴露,绝不静默返回坏字节;
 * - key 已在契约层排除穿越语义,这里仍以 resolved 路径前缀做第二道防线。
 */
export class LocalObjectStorage implements ObjectStoragePort {
  constructor(private readonly providedRoot?: string) {}

  private rootPromise: Promise<string> | null = null;

  private resolveRoot(): Promise<string> {
    this.rootPromise ??= (async () => {
      if (this.providedRoot) return path.resolve(this.providedRoot);
      if (process.env.OBJECT_STORAGE_ROOT) {
        return path.resolve(process.env.OBJECT_STORAGE_ROOT);
      }
      return path.join(await findWorkspaceRoot(), 'uploads', 'artifacts');
    })();
    return this.rootPromise;
  }

  private async absolutePath(key: string): Promise<string> {
    if (!isValidObjectKey(key)) {
      throw new ObjectStorageError('invalid_key', `对象 key 非法: ${key}`);
    }
    const root = await this.resolveRoot();
    const resolved = path.resolve(root, key);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new ObjectStorageError('invalid_key', '对象 key 越出存储根目录');
    }
    return resolved;
  }

  async put(input: {
    key: string;
    bytes: Uint8Array;
    contentType?: string;
  }): Promise<StoredObject> {
    const target = await this.absolutePath(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temp, input.bytes);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw new ObjectStorageError(
        'storage_unavailable',
        `对象写入失败: ${(error as Error).message}`,
      );
    }
    return {
      key: input.key,
      checksum: sha256Hex(input.bytes),
      sizeBytes: input.bytes.byteLength,
    };
  }

  async read(key: string): Promise<Uint8Array> {
    const target = await this.absolutePath(key);
    try {
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ObjectStorageError('object_not_found', `对象不存在: ${key}`);
      }
      throw new ObjectStorageError(
        'storage_unavailable',
        `对象读取失败: ${(error as Error).message}`,
      );
    }
  }

  /** 读取并强制校验完整性;调用方持有权威 checksum(来自 artifact_versions)。 */
  async readVerified(key: string, expectedChecksum: string): Promise<Uint8Array> {
    const bytes = await this.read(key);
    if (sha256Hex(bytes) !== expectedChecksum) {
      throw new ObjectStorageError(
        'checksum_mismatch',
        `对象内容与校验和不符: ${key}`,
      );
    }
    return bytes;
  }

  async delete(key: string): Promise<void> {
    const target = await this.absolutePath(key);
    await rm(target, { force: true });
  }
}
