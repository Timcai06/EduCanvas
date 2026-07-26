import 'server-only';

import {
  AssetAccessError,
  DrizzleAssetRepository,
  type OwnedStoredAssetVersion,
} from '@educanvas/db';
import mammoth from 'mammoth';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { projectOwnedSourceResource } from '../canvas/source-resource-adapter';
import { readStoredAssetBytes } from './asset-storage';
import type { AssetPreview } from '@/features/assets/asset-preview-contract';
import type { CanvasResource } from '@educanvas/canvas-protocol';

const assets = new DrizzleAssetRepository();
const BINARY_PREVIEW_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export class AssetPreviewError extends Error {
  constructor(
    readonly code: 'asset_not_found' | 'preview_unavailable',
    readonly status: 404 | 422,
  ) {
    super(code);
    this.name = 'AssetPreviewError';
  }
}

async function loadStoredVersion(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}): Promise<OwnedStoredAssetVersion> {
  try {
    return await assets.loadOwnedCurrentStoredVersion({
      ownerSubjectId: input.identity.studentId,
      spaceId: input.spaceId,
      assetId: input.assetId,
    });
  } catch (error) {
    if (error instanceof AssetAccessError) {
      throw new AssetPreviewError('asset_not_found', 404);
    }
    throw error;
  }
}

/**
 * 返回浏览器可消费的预览描述；对象存储键只留在服务端。
 * 二进制文件通过同源、逐次鉴权的文件端点读取，文本只返回有界提取结果。
 */
export async function loadOwnedAssetPreview(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}): Promise<AssetPreview> {
  return (await loadOwnedAssetPreviewDetail(input)).preview;
}

/** 在旧预览投影旁附加统一资源描述，不改变既有Preview消费者。 */
export async function loadOwnedAssetPreviewDetail(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}): Promise<{ preview: AssetPreview; canvasResource: CanvasResource }> {
  const [version, policy] = await Promise.all([
    loadStoredVersion(input),
    assets.getAccessPolicy({
      ownerSubjectId: input.identity.studentId,
      spaceId: input.spaceId,
      assetId: input.assetId,
    }),
  ]);
  const fileUrl = `/api/v1/chat/assets/${encodeURIComponent(input.assetId)}/file`;
  const canvasResource = projectOwnedSourceResource({
    assetId: version.assetId,
    notebookId: input.spaceId,
    title: version.displayName,
    mimeType: version.mimeType,
    status: 'ready',
    origin: version.origin,
    createdAt: version.createdAt,
    accessRole: policy.role,
    isCreator: policy.isCreator,
    version: {
      versionId: version.versionId,
      byteSize: version.byteSize,
      checksum: version.contentHash,
    },
  });
  if (version.mimeType === 'application/pdf') {
    return {
      preview: {
        kind: 'pdf',
        fileName: version.displayName,
        mimeType: version.mimeType,
        fileUrl,
      },
      canvasResource,
    };
  }
  if (
    version.mimeType === 'image/png' ||
    version.mimeType === 'image/jpeg' ||
    version.mimeType === 'image/webp'
  ) {
    return {
      preview: {
        kind: 'image',
        fileName: version.displayName,
        mimeType: version.mimeType,
        fileUrl,
      },
      canvasResource,
    };
  }
  if (version.mimeType === 'text/markdown' && version.extractedText) {
    return {
      preview: {
        kind: 'markdown',
        fileName: version.displayName,
        mimeType: 'text/markdown',
        content: version.extractedText.slice(0, 120_000),
      },
      canvasResource,
    };
  }
  if (version.mimeType === 'text/plain' && version.extractedText) {
    return {
      preview: {
        kind: 'text',
        fileName: version.displayName,
        mimeType: 'text/plain',
        content: version.extractedText.slice(0, 120_000),
      },
      canvasResource,
    };
  }
  if (
    version.mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml'
  ) {
    const bytes = await readStoredAssetBytes(version.storageKey);
    const result = await mammoth.convertToHtml({
      buffer: Buffer.from(bytes),
    });
    return {
      preview: {
        kind: 'docx',
        fileName: version.displayName,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content: result.value.slice(0, 500_000),
        warnings: result.messages.map((m) => m.message),
      },
      canvasResource,
    };
  }
  throw new AssetPreviewError('preview_unavailable', 422);
}

/**
 * 读取经所有权校验的可预览二进制。调用方只能把结果以内联、nosniff响应返回，
 * 不得接受客户端传入的storageKey或任意文件路径。
 */
export async function readOwnedAssetPreviewFile(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }> {
  const version = await loadStoredVersion(input);
  if (!BINARY_PREVIEW_MIME_TYPES.has(version.mimeType)) {
    throw new AssetPreviewError('preview_unavailable', 422);
  }
  const bytes = await readStoredAssetBytes(version.storageKey);
  if (
    bytes.byteLength !== version.byteSize ||
    bytes.byteLength > 10 * 1024 * 1024
  ) {
    throw new AssetPreviewError('preview_unavailable', 422);
  }
  return {
    bytes,
    mimeType: version.mimeType,
    fileName: version.displayName,
  };
}

/** 软删除当前Notebook内的来源；跨用户与不存在资产统一按404处理。 */
export async function tombstoneOwnedAsset(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}): Promise<void> {
  const deleted = await assets.tombstoneOwnedAsset({
    ownerSubjectId: input.identity.studentId,
    spaceId: input.spaceId,
    assetId: input.assetId,
  });
  if (!deleted) throw new AssetPreviewError('asset_not_found', 404);
}
