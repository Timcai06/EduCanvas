import 'server-only';

import { createHash } from 'node:crypto';
import {
  DrizzleAssetRepository,
  type AssetSnapshot,
  type CursorPage,
  type TemporalIdCursor,
} from '@educanvas/db';
import {
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  AudioInspectionError,
  VIDEO_SOURCE_MAX_INPUT_BYTES,
  WebPageError,
  fetchWebPage,
  inspectSupportedAudioSource,
  supportsTextExtraction,
} from '@educanvas/asset-processing';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { loadOwnedTeachingGatewayTarget } from '../teaching/learning-session';
import { type FetchedWebPage } from '../tools/web-page';
import {
  removeStoredAsset,
  storeAssetBytes,
  type StoredAssetObject,
} from './asset-storage';
import { detectAssetFile } from './asset-file-detection';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** 音频转录需要更多空间（Whisper API 限制 25MB） */
export const MAX_AUDIO_UPLOAD_BYTES = AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES;
/**
 * 视频上限与 `asset_versions_size_check` 的库级字节上限同值：上传层放行超过它的
 * 文件只会在落库时撞上约束，那是更晚也更难解释的失败。时长与分辨率无法从字节数
 * 判断，必须等 Worker 用 ffprobe 判定（ADR-0016）。
 */
export const MAX_VIDEO_UPLOAD_BYTES = VIDEO_SOURCE_MAX_INPUT_BYTES;
const MAX_EXTRACTED_TEXT = 120_000;

const assets = new DrizzleAssetRepository();

export class AssetUploadError extends Error {
  constructor(
    readonly code:
      | 'invalid_upload'
      | 'unsupported_file_type'
      | 'file_too_large'
      | 'audio_too_large'
      | 'video_too_large'
      | 'audio_duration_exceeded'
      | 'audio_metadata_unavailable'
      | 'session_not_found'
      | 'pdf_text_unavailable'
      | 'text_content_unavailable'
      | `link_${string}`,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'AssetUploadError';
  }
}

function safeDisplayName(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  return [...(normalized || '未命名文件')].slice(0, 180).join('');
}

export async function uploadOwnedAsset(input: {
  identity: AnonymousIdentity;
  file: File;
  scope: 'turn' | 'space';
}): Promise<AssetSnapshot> {
  const target = await loadOwnedTeachingGatewayTarget(input.identity);
  if (!target) throw new AssetUploadError('session_not_found', 404);
  return uploadOwnedAssetToSpace({ ...input, spaceId: target.notebookId });
}

/** 平台级上传边界：调用方先完成Conversation/Space所有权校验，再传入可信spaceId。 */
export async function uploadOwnedAssetToSpace(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  file: File;
  scope: 'turn' | 'space';
}): Promise<AssetSnapshot> {
  /* 读入字节前先按全局最大值粗筛，避免把超大文件读进内存再拒绝；
     按类型的精确上限在识别出格式之后再判一次。 */
  const absoluteMaxBytes = Math.max(
    MAX_AUDIO_UPLOAD_BYTES,
    MAX_VIDEO_UPLOAD_BYTES,
  );
  if (
    !Number.isSafeInteger(input.file.size) ||
    input.file.size <= 0 ||
    input.file.size > absoluteMaxBytes
  ) {
    throw new AssetUploadError(
      input.file.size > absoluteMaxBytes ? 'file_too_large' : 'invalid_upload',
      input.file.size > absoluteMaxBytes ? 413 : 400,
    );
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const detected = detectAssetFile(bytes, input.file.name);
  if (!detected) throw new AssetUploadError('unsupported_file_type', 415);

  /* 音频与文档/图片使用 25MB 上限，视频使用平台 50MB 上限（也是
     asset_versions 的库级字节上限）。 */
  const maxBytes =
    detected.kind === 'audio'
      ? MAX_AUDIO_UPLOAD_BYTES
      : detected.kind === 'video'
        ? MAX_VIDEO_UPLOAD_BYTES
        : MAX_UPLOAD_BYTES;
  if (input.file.size > maxBytes) {
    throw new AssetUploadError(
      detected.kind === 'audio'
        ? 'audio_too_large'
        : detected.kind === 'video'
          ? 'video_too_large'
          : 'file_too_large',
      413,
    );
  }
  if (detected.kind === 'audio') {
    try {
      const inspected = await inspectSupportedAudioSource(bytes);
      if (inspected.mimeType !== detected.mimeType) {
        throw new AudioInspectionError('unsupported_audio_type');
      }
    } catch (error) {
      if (error instanceof AudioInspectionError) {
        if (error.code === 'audio_duration_exceeded') {
          throw new AssetUploadError('audio_duration_exceeded', 422);
        }
        if (error.code === 'audio_input_too_large') {
          throw new AssetUploadError('audio_too_large', 413);
        }
        throw new AssetUploadError('audio_metadata_unavailable', 422);
      }
      throw error;
    }
  }
  let stored: StoredAssetObject | null = null;
  try {
    stored = await storeAssetBytes({
      ownerSubjectId: input.identity.studentId,
      bytes,
      extension: detected.extension,
    });
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const common = {
      ownerSubjectId: input.identity.studentId,
      spaceId: input.spaceId,
      scope: input.scope,
      kind: detected.kind,
      displayName: safeDisplayName(input.file.name),
      mimeType: detected.mimeType,
      byteSize: bytes.byteLength,
      contentHash,
      storageKey: stored.storageKey,
    };
    /*
     * 可抽取文本的类型（PDF/DOCX/文本）和可转录音频走异步：落库为 processing 并入队，
     * 立即返回（ADR-0010）。上传响应时间因此与文件大小解耦，用户先在来源列表看到
     * 「处理中」。
     *
     * 图片等无需抽取的类型没有等待的理由，仍然一次性写成 ready——为它们建一个
     * 必然空转的任务只会让队列和状态机都变复杂。
     */
    if (
      supportsTextExtraction(detected.mimeType) ||
      detected.kind === 'audio' ||
      detected.kind === 'video'
    ) {
      return (await assets.createUploadedPending(common)).snapshot;
    }
    return await assets.createUploaded({
      ...common,
      extractedText: null,
      outcome: { status: 'ready' },
    });
  } catch (error) {
    if (stored && !(error instanceof AssetUploadError)) {
      await removeStoredAsset(stored).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * 链接导入为来源(M3b-C):抓取公开网页 → 抽取正文 → 以 kind=link、
 * origin=url_import 落为不可变资产版本;正文文本即物化内容,直接进入
 * 既有的资产上下文链路(可勾选、随轮携带)。
 */
export async function importOwnedLinkAsset(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  url: string;
}): Promise<AssetSnapshot> {
  let page;
  try {
    page = await fetchWebPage(input.url, { allowEmptyText: true });
  } catch (error) {
    throw new AssetUploadError(
      error instanceof WebPageError ? error.code : 'link_network_unreachable',
      422,
    );
  }
  const stored = await storeAssetBytes({
    ownerSubjectId: input.identity.studentId,
    bytes: page.bytes,
    extension: 'html',
  });
  try {
    const host = new URL(page.finalUrl).hostname;
    return (
      await assets.createUploadedPending({
        ownerSubjectId: input.identity.studentId,
        spaceId: input.spaceId,
        scope: 'space',
        kind: 'link',
        origin: 'url_import',
        displayName: safeDisplayName(page.title?.trim() || host),
        mimeType: 'text/html',
        byteSize: page.bytes.byteLength,
        contentHash: createHash('sha256').update(page.bytes).digest('hex'),
        storageKey: stored.storageKey,
        webSnapshot: {
          requestedUrl: page.requestedUrl,
          finalUrl: page.finalUrl,
          responseContentType: page.contentType,
          pageTitle: page.title,
          fetchedAt: page.fetchedAt,
        },
      })
    ).snapshot;
  } catch (error) {
    await removeStoredAsset(stored).catch(() => undefined);
    throw error;
  }
}

/**
 * 将已经通过网页 Tool 安全边界取得的完整正文保存为 Link Asset。
 * Tool 路径复用此函数，避免为了持久化再次请求同一 URL，确保引用对应本次读取快照。
 */
export async function persistFetchedWebPageAsset(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  page: FetchedWebPage;
  researchSource?: boolean;
}): Promise<AssetSnapshot> {
  const page = input.page;
  const text = [...page.text].slice(0, MAX_EXTRACTED_TEXT).join('');
  const stored = await storeAssetBytes({
    ownerSubjectId: input.identity.studentId,
    bytes: page.bytes,
    extension: 'html',
  });
  try {
    const host = new URL(page.url).hostname;
    return await assets.createUploaded({
      ownerSubjectId: input.identity.studentId,
      spaceId: input.spaceId,
      scope: 'space',
      kind: 'link',
      origin: input.researchSource ? 'research_web' : 'url_import',
      displayName: safeDisplayName(page.title?.trim() || host),
      mimeType: page.contentType,
      byteSize: page.bytes.byteLength,
      contentHash: createHash('sha256').update(page.bytes).digest('hex'),
      storageKey: stored.storageKey,
      extractedText: text,
      outcome: { status: 'ready' },
      webSnapshot: {
        requestedUrl: page.requestedUrl,
        finalUrl: page.url,
        responseContentType: page.contentType,
        pageTitle: page.title,
        fetchedAt: page.fetchedAt,
      },
    });
  } catch (error) {
    await removeStoredAsset(stored).catch(() => undefined);
    throw error;
  }
}

export async function listOwnedAssets(
  identity: AnonymousIdentity,
): Promise<readonly AssetSnapshot[]> {
  const target = await loadOwnedTeachingGatewayTarget(identity);
  if (!target) throw new AssetUploadError('session_not_found', 404);
  return listOwnedSpaceAssets(identity, target.notebookId);
}

export async function listOwnedSpaceAssets(
  identity: AnonymousIdentity,
  spaceId: string,
): Promise<readonly AssetSnapshot[]> {
  return assets.listOwnedSpace({
    ownerSubjectId: identity.studentId,
    spaceId,
  });
}

export async function listOwnedSpaceAssetsPage(
  identity: AnonymousIdentity,
  spaceId: string,
  input: { limit: number; cursor: TemporalIdCursor | null },
): Promise<CursorPage<AssetSnapshot>> {
  return assets.listAccessibleSpacePage({
    ownerSubjectId: identity.studentId,
    spaceId,
    ...input,
  });
}
