import 'server-only';

import { createHash } from 'node:crypto';
import { DrizzleAssetRepository, type AssetSnapshot } from '@educanvas/db';
import { extractText, getDocumentProxy } from 'unpdf';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { loadOwnedTeachingSession } from '../teaching/learning-session';
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
      | `link_${string}`,
    readonly status: number,
  ) {
    super(code);
    this.name = 'AssetUploadError';
  }
}

interface DetectedFile {
  kind: 'image' | 'document';
  mimeType: string;
  extension: string;
}

function detectFile(bytes: Uint8Array): DetectedFile | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { kind: 'document', mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function safeDisplayName(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  return [...(normalized || '未命名文件')].slice(0, 180).join('');
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: true });
  const normalized = result.text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) {
    throw new AssetUploadError('pdf_text_unavailable', 422);
  }
  return [...normalized].slice(0, MAX_EXTRACTED_TEXT).join('');
}

export async function uploadOwnedAsset(input: {
  identity: AnonymousIdentity;
  file: File;
  scope: 'turn' | 'space';
}): Promise<AssetSnapshot> {
  const session = await loadOwnedTeachingSession(input.identity);
  if (!session) throw new AssetUploadError('session_not_found', 404);
  return uploadOwnedAssetToSpace({ ...input, spaceId: session.id });
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
  const detected = detectFile(bytes);
  if (!detected) throw new AssetUploadError('unsupported_file_type', 415);
  if (input.file.type && input.file.type.toLowerCase() !== detected.mimeType) {
    throw new AssetUploadError('unsupported_file_type', 415);
  }

  let stored: StoredAssetObject | null = null;
  try {
    stored = await storeAssetBytes({
      ownerSubjectId: input.identity.studentId,
      bytes,
      extension: detected.extension,
    });
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    try {
      const extractedText =
        detected.kind === 'document' ? await extractPdfText(bytes) : null;
      return await assets.createUploaded({
        ownerSubjectId: input.identity.studentId,
        spaceId: input.spaceId,
        scope: input.scope,
        kind: detected.kind,
        displayName: safeDisplayName(input.file.name),
        mimeType: detected.mimeType,
        byteSize: bytes.byteLength,
        contentHash,
        storageKey: stored.storageKey,
        extractedText,
        outcome: { status: 'ready' },
      });
    } catch (error) {
      if (!(error instanceof AssetUploadError)) throw error;
      await assets.createUploaded({
        ownerSubjectId: input.identity.studentId,
        spaceId: input.spaceId,
        scope: input.scope,
        kind: detected.kind,
        displayName: safeDisplayName(input.file.name),
        mimeType: detected.mimeType,
        byteSize: bytes.byteLength,
        contentHash,
        storageKey: stored.storageKey,
        extractedText: null,
        outcome: { status: 'failed', failureCode: error.code },
      });
      throw error;
    }
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
  const session = await loadOwnedTeachingSession(identity);
  if (!session) throw new AssetUploadError('session_not_found', 404);
  return listOwnedSpaceAssets(identity, session.id);
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
