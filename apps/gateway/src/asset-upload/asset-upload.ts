import { createHash } from 'node:crypto';
import type { AssetScope } from '@educanvas/agent-core';
import {
  AssetAccessError,
  type AssetSnapshot,
  type CreateUploadedAssetInput,
  type StoredAssetObject,
} from '@educanvas/db';
import { detectAssetFile } from './asset-file-detection';

/**
 * Gateway 桌面上传统一边界（DP10）。
 *
 * 只接收 PNG/JPEG/WebP 图片与 PDF 文档（≤25MB）。图片落库即 ready；
 * PDF 落为 processing 并入队，由既有 worker 提取文本后转为 ready。
 * 归属与权限由 repository 内部事务中的 `requireNotebookAccess` 强制，
 * 本服务不做第二次重复校验。
 */

export const MAX_GATEWAY_ASSET_UPLOAD_BYTES = 25 * 1024 * 1024;

export class GatewayAssetUploadError extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 415,
    readonly code:
      'INVALID_REQUEST' | 'NOT_FOUND' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_MEDIA',
  ) {
    super(code);
    this.name = 'GatewayAssetUploadError';
  }
}

/** 服务依赖窄口：组合根注入 repository + 共享对象存储，便于测试注入桩。 */
export interface GatewayAssetUploadPort {
  createUploaded(input: CreateUploadedAssetInput): Promise<AssetSnapshot>;
  createUploadedPending(
    input: Omit<CreateUploadedAssetInput, 'extractedText' | 'outcome'>,
    options?: { enqueue?: boolean },
  ): Promise<{ snapshot: AssetSnapshot; versionId: string; jobId: string }>;
  getOwnedSnapshot(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<AssetSnapshot>;
  storeBytes(input: {
    ownerSubjectId: string;
    bytes: Uint8Array;
    extension: string;
  }): Promise<StoredAssetObject>;
  removeStored(stored: StoredAssetObject): Promise<void>;
}

function safeDisplayName(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  return [...(normalized || '未命名文件')].slice(0, 180).join('');
}

export class GatewayAssetUploadService {
  constructor(private readonly deps: GatewayAssetUploadPort) {}

  async upload(input: {
    trustedSubjectId: string;
    notebookId: string;
    file: File;
    scope: AssetScope;
  }): Promise<AssetSnapshot> {
    if (!Number.isSafeInteger(input.file.size) || input.file.size <= 0) {
      throw new GatewayAssetUploadError(400, 'INVALID_REQUEST');
    }
    if (input.file.size > MAX_GATEWAY_ASSET_UPLOAD_BYTES) {
      throw new GatewayAssetUploadError(413, 'FILE_TOO_LARGE');
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const detected = detectAssetFile(bytes);
    if (!detected) throw new GatewayAssetUploadError(415, 'UNSUPPORTED_MEDIA');

    let stored: StoredAssetObject | null = null;
    try {
      stored = await this.deps.storeBytes({
        ownerSubjectId: input.trustedSubjectId,
        bytes,
        extension: detected.extension,
      });
      const common = {
        ownerSubjectId: input.trustedSubjectId,
        spaceId: input.notebookId,
        scope: input.scope,
        kind: detected.kind,
        displayName: safeDisplayName(input.file.name),
        mimeType: detected.mimeType,
        byteSize: bytes.byteLength,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        storageKey: stored.storageKey,
      };
      /* 网关只收图片与 PDF：PDF 需要异步抽取文本，图片无需等待直接 ready。 */
      if (detected.kind === 'document') {
        return (await this.deps.createUploadedPending(common)).snapshot;
      }
      return await this.deps.createUploaded({
        ...common,
        extractedText: null,
        outcome: { status: 'ready' },
      });
    } catch (error) {
      if (stored && !(error instanceof GatewayAssetUploadError)) {
        await this.deps.removeStored(stored).catch(() => undefined);
      }
      throw error;
    }
  }

  /** 桌面 ready-wait 轮询入口：只返回当前用户在当前 notebook 拥有的资产。 */
  async get(input: {
    trustedSubjectId: string;
    notebookId: string;
    assetId: string;
  }): Promise<AssetSnapshot> {
    try {
      return await this.deps.getOwnedSnapshot({
        ownerSubjectId: input.trustedSubjectId,
        spaceId: input.notebookId,
        assetId: input.assetId,
      });
    } catch (error) {
      if (error instanceof AssetAccessError) {
        throw new GatewayAssetUploadError(404, 'NOT_FOUND');
      }
      throw error;
    }
  }
}
