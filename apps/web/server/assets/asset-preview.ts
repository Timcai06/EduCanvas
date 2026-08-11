import 'server-only';

import { createHash } from 'node:crypto';
import {
  ASSET_PREVIEW_MAX_INPUT_BYTES,
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  VIDEO_SOURCE_MAX_INPUT_BYTES,
  rewriteMarkdownImageRefs,
} from '@educanvas/asset-processing';
import {
  AssetAccessError,
  DrizzleAssetRepository,
  type OwnedStoredAssetVersion,
} from '@educanvas/db';
import mammoth from 'mammoth';
import { z } from 'zod';
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
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'video/quicktime',
]);
const transcriptionMetadataSchema = z
  .object({
    language: z.string().max(64).nullable(),
    durationSeconds: z.number().finite().positive().max(3_600),
  })
  .passthrough();

/**
 * D04：转录文本读取——内容权威是 transcription representation 的对象存储
 * （旧列仅保留兼容镜像）；仅有旧字段、对象缺失或校验失败时按冻结规则回退
 * transcriptionText。对象读取失败不向浏览器泄露内部路径或错误细节。
 */
async function resolveTranscriptionText(
  version: OwnedStoredAssetVersion,
): Promise<string | null> {
  const representation = version.transcriptionRepresentation;
  if (representation && representation.status === 'ready') {
    try {
      const bytes = await readStoredAssetBytes(
        representation.derivedStorageKey,
      );
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== representation.checksum) {
        throw new Error('asset_representation_checksum_mismatch');
      }
      return new TextDecoder().decode(bytes);
    } catch {
      return version.transcriptionText;
    }
  }
  return version.transcriptionText;
}

/**
 * ADR-0026 决定 3/6：读取默认 text 表示的派生 Markdown，图片引用投影为
 * 已鉴权资源 URL（D1 资源路由逐次复验权限），校验和与声明不一致或对象
 * 缺失时按无表示处理（调用方回退原格式预览）。截断到结构化阅读上限。
 */
async function resolveStructuredMarkdown(
  representation: NonNullable<OwnedStoredAssetVersion['textRepresentation']>,
  assetId: string,
): Promise<string | null> {
  try {
    const bytes = await readStoredAssetBytes(representation.derivedStorageKey);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== representation.checksum) {
      throw new Error('asset_representation_checksum_mismatch');
    }
    const markdown = rewriteMarkdownImageRefs(
      new TextDecoder().decode(bytes),
      (relativePath) =>
        `/api/v1/chat/assets/${encodeURIComponent(assetId)}/resources/${relativePath}`,
    );
    return markdown.slice(0, 120_000);
  } catch {
    return null;
  }
}

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

async function loadAccessPolicy(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}) {
  try {
    return await assets.getAccessPolicy({
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
    loadAccessPolicy(input),
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
  if (version.mimeType === 'text/markdown') {
    return {
      preview: {
        kind: 'markdown',
        fileName: version.displayName,
        mimeType: 'text/markdown',
        content: (version.extractedText ?? '').slice(0, 120_000),
      },
      canvasResource,
    };
  }
  if (version.mimeType === 'text/plain') {
    return {
      preview: {
        kind: 'text',
        fileName: version.displayName,
        mimeType: 'text/plain',
        content: (version.extractedText ?? '').slice(0, 120_000),
      },
      canvasResource,
    };
  }
  if (
    version.mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml'
  ) {
    /* ADR-0026 决定 2/6：MinerU 结构化派生可用时优先提供结构化阅读视图，
       原件下载入口始终保留（决定 1：不把派生 Markdown 冒充原始 DOCX）。 */
    const representation = version.textRepresentation;
    const structured =
      representation &&
      representation.status === 'ready' &&
      representation.quality === 'structured'
        ? await resolveStructuredMarkdown(representation, version.assetId)
        : null;
    let content = '';
    const warnings: string[] = [];
    if (!structured) {
      /* 降级/处理中/失败或无表示时保持 mammoth 原格式预览。 */
      const bytes = await readStoredAssetBytes(version.storageKey);
      const result = await mammoth.convertToHtml({
        buffer: Buffer.from(bytes),
      });
      content = result.value.slice(0, 500_000);
      warnings.push(...result.messages.map((m) => m.message));
    }
    return {
      preview: {
        kind: 'docx',
        fileName: version.displayName,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content,
        warnings,
        representation: representation
          ? {
              quality: representation.quality,
              markdown: structured ?? undefined,
            }
          : null,
        downloadUrl: `/api/v1/chat/assets/${encodeURIComponent(version.assetId)}/file?download=1`,
      },
      canvasResource,
    };
  }
  if (
    version.mimeType === 'audio/mpeg' ||
    version.mimeType === 'audio/wav' ||
    version.mimeType === 'audio/ogg' ||
    version.mimeType === 'audio/flac' ||
    version.mimeType === 'audio/webm' ||
    version.mimeType === 'audio/mp4' ||
    version.mimeType === 'audio/x-m4a'
  ) {
    /**
     * 转录文本是派生内容，存储在 transcriptionText 列。
     * transcriptionMetadata 只包含仓储白名单重建的安全审计子集，
     * 不包含 Provider response id、Prompt 正文或原始供应商响应体。
     */
    const parsedMetadata = transcriptionMetadataSchema.safeParse(
      version.transcriptionMetadata,
    );
    const transcriptionMeta = parsedMetadata.success
      ? parsedMetadata.data
      : null;
    const transcriptionText = await resolveTranscriptionText(version);
    return {
      preview: {
        kind: 'audio' as const,
        fileName: version.displayName,
        mimeType: version.mimeType,
        fileUrl,
        transcription: transcriptionText
          ? {
              text: transcriptionText.slice(0, 500_000),
              language: transcriptionMeta?.language ?? null,
              durationSeconds: transcriptionMeta?.durationSeconds ?? null,
            }
          : null,
      },
      canvasResource,
    };
  }
  if (
    version.mimeType === 'video/mp4' ||
    version.mimeType === 'video/quicktime'
  ) {
    const parsedMetadata = transcriptionMetadataSchema.safeParse(
      version.transcriptionMetadata,
    );
    const transcriptionMeta = parsedMetadata.success
      ? parsedMetadata.data
      : null;
    const derivativeStatus = new Map(
      version.derivedStatuses.map((item) => [item.kind, item.status]),
    );
    const transcriptionText = await resolveTranscriptionText(version);
    return {
      preview: {
        kind: 'video',
        fileName: version.displayName,
        mimeType: version.mimeType,
        fileUrl,
        transcription: transcriptionText
          ? {
              text: transcriptionText.slice(0, 500_000),
              language: transcriptionMeta?.language ?? null,
              durationSeconds: transcriptionMeta?.durationSeconds ?? null,
            }
          : null,
        derivatives: {
          transcription: derivativeStatus.get('transcription') ?? 'unavailable',
          keyframes: derivativeStatus.get('keyframes') ?? 'unavailable',
        },
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
  const maxBytes = version.mimeType.startsWith('audio/')
    ? AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES
    : version.mimeType.startsWith('video/')
      ? VIDEO_SOURCE_MAX_INPUT_BYTES
      : ASSET_PREVIEW_MAX_INPUT_BYTES;
  if (
    bytes.byteLength !== version.byteSize ||
    bytes.byteLength > maxBytes ||
    createHash('sha256').update(bytes).digest('hex') !== version.contentHash
  ) {
    throw new AssetPreviewError('preview_unavailable', 422);
  }
  return {
    bytes,
    mimeType: version.mimeType,
    fileName: version.displayName,
  };
}

/**
 * 读取经所有权校验的原件字节供下载（ADR-0026 决定 1：Office 等浏览器无法
 * 忠实预览的格式保留原件下载入口）。任何 MIME 都允许下载；字节数与内容
 * hash 必须与 Version 声明一致，防止对象被篡改后外泄。调用方只能以内联
 * 或 attachment、nosniff 响应返回，不得接受客户端传入的 storageKey。
 */
export async function readOwnedAssetDownload(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  assetId: string;
}): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }> {
  const version = await loadStoredVersion(input);
  const bytes = await readStoredAssetBytes(version.storageKey);
  if (
    bytes.byteLength !== version.byteSize ||
    createHash('sha256').update(bytes).digest('hex') !== version.contentHash
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
