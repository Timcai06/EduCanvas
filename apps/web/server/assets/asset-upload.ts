import 'server-only';

import { createHash } from 'node:crypto';
import {
  DrizzleAssetRepository,
  type AssetSnapshot,
  type CursorPage,
  type TemporalIdCursor,
} from '@educanvas/db';
import { supportsTextExtraction } from '@educanvas/asset-processing';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { loadOwnedTeachingGatewayTarget } from '../teaching/learning-session';
import {
  WebPageFetchError,
  fetchReadableWebPage,
  type FetchedWebPage,
} from '../tools/web-page';
import {
  removeStoredAsset,
  storeAssetBytes,
  type StoredAssetObject,
} from './asset-storage';
import { detectAssetFile } from './asset-file-detection';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 120_000;

const assets = new DrizzleAssetRepository();

export class AssetUploadError extends Error {
  constructor(
    readonly code:
      | 'invalid_upload'
      | 'unsupported_file_type'
      | 'file_too_large'
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
  if (
    !Number.isSafeInteger(input.file.size) ||
    input.file.size <= 0 ||
    input.file.size > MAX_UPLOAD_BYTES
  ) {
    throw new AssetUploadError(
      input.file.size > MAX_UPLOAD_BYTES ? 'file_too_large' : 'invalid_upload',
      input.file.size > MAX_UPLOAD_BYTES ? 413 : 400,
    );
  }

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const detected = detectAssetFile(bytes, input.file.name);
  if (!detected) throw new AssetUploadError('unsupported_file_type', 415);
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
     * 可抽取文本的类型走异步：落库为 processing 并入队，立即返回（ADR-0010）。
     * 上传响应时间因此与文件大小解耦，用户先在来源列表看到「处理中」。
     *
     * 图片等无需抽取的类型没有等待的理由，仍然一次性写成 ready——为它们建一个
     * 必然空转的任务只会让队列和状态机都变复杂。
     */
    if (supportsTextExtraction(detected.mimeType)) {
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
    page = await fetchReadableWebPage(input.url);
  } catch (error) {
    const code =
      error instanceof WebPageFetchError ? error.code : 'fetch_failed';
    throw new AssetUploadError(`link_${code}`, 422);
  }
  return persistFetchedWebPageAsset({
    identity: input.identity,
    spaceId: input.spaceId,
    page,
  });
}

/**
 * 将已经通过 fetchReadableWebPage 安全边界取得的完整正文保存为 Link Asset。
 * Tool 路径复用此函数，避免为了持久化再次请求同一 URL，确保引用对应本次读取快照。
 */
export async function persistFetchedWebPageAsset(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  page: FetchedWebPage;
}): Promise<AssetSnapshot> {
  const page = input.page;
  const text = [...page.text].slice(0, MAX_EXTRACTED_TEXT).join('');
  const bytes = new TextEncoder().encode(text);
  const stored = await storeAssetBytes({
    ownerSubjectId: input.identity.studentId,
    bytes,
    extension: 'txt',
  });
  try {
    const host = new URL(page.url).hostname;
    return await assets.createUploaded({
      ownerSubjectId: input.identity.studentId,
      spaceId: input.spaceId,
      scope: 'space',
      kind: 'link',
      origin: 'url_import',
      displayName: safeDisplayName(page.title?.trim() || host),
      mimeType: 'text/plain',
      byteSize: bytes.byteLength,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      storageKey: stored.storageKey,
      extractedText: text,
      outcome: { status: 'ready' },
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
