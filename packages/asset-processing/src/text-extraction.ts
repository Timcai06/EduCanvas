import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

/**
 * 文本抽取的字符上限。
 *
 * 它同时是 Prompt 预算的上游闸门和数据库列的保护：一份超长 PDF 不应该因为
 * 「解析成功」就把十几万字塞进 `asset_versions.extracted_text`。截断发生在
 * 这里而不是消费侧，保证任何调用方读到的文本都已经是有界的。
 */
export const ASSET_TEXT_MAX_CHARACTERS = 120_000;

/**
 * 稳定失败码。它们会落进 `asset_processing_jobs.failure_code` 与
 * `asset_versions.failure_code`，并被 HTTP 层映射成用户文案，
 * 因此只能追加、不能改写含义。
 */
export const assetExtractionFailureCodes = [
  /** PDF 结构正常但没有文字层（扫描件），需要 OCR 才能处理。 */
  'pdf_text_unavailable',
  /** 文本类文件解码失败、含控制字符或抽取后为空。 */
  'text_content_unavailable',
  /** MIME 不在本包的支持范围内，调用方不该把它排进解析队列。 */
  'unsupported_media_type',
] as const;

export type AssetExtractionFailureCode =
  (typeof assetExtractionFailureCodes)[number];

export class AssetExtractionError extends Error {
  override readonly name = 'AssetExtractionError';

  constructor(
    readonly code: AssetExtractionFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

const DOCX_MIME_TYPES = new Set([
  /* 服务端把 DOCX 归一化成这个不带 `.document` 后缀的内部值
     （见 apps/web/server/assets/asset-file-detection.ts）。它与浏览器上报的
     标准 MIME 不同，两者都存在是有意的，不要「对齐」其中一处。 */
  'application/vnd.openxmlformats-officedocument.wordprocessingml',
]);

const PLAIN_TEXT_MIME_TYPES = new Set(['text/markdown', 'text/plain']);

/** MinerU 转换服务受理的文档类型（ADR-0026 决定 2）。 */
const MINERU_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  /* 服务端归一化后的内部值（见 DOCX_MIME_TYPES 注释），PPTX/XLSX 同型。 */
  'application/vnd.openxmlformats-officedocument.wordprocessingml',
  'application/vnd.openxmlformats-officedocument.presentationml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml',
]);

/**
 * 文档抽取路由（ADR-0026 决定 2）。
 *
 * - `mineru`：PDF/DOCX/PPTX/XLSX 进入独立 MinerU 转换服务，产出结构化
 *   Markdown；MinerU 不可用时由编排层降级为纯文本抽取。
 * - `direct_decode`：TXT/Markdown 严格 UTF-8 解码，不调用 MinerU。
 * - `null`：不在文档抽取范围内（图片、音频等另有流程）。
 */
export function routeDocumentExtraction(
  mimeType: string,
): 'mineru' | 'direct_decode' | null {
  if (MINERU_DOCUMENT_MIME_TYPES.has(mimeType)) return 'mineru';
  if (PLAIN_TEXT_MIME_TYPES.has(mimeType)) return 'direct_decode';
  return null;
}

/** 调用方据此判断某个版本要不要排进解析队列，避免为图片建一个必然失败的任务。
 *  判定范围与 MinerU 受理类型 + 纯文本解码一致（ADR-0026 决定 2），
 *  PPTX/XLSX 与 PDF/DOCX 同权：必须落 processing 排入转换队列，
 *  不能静默写成 ready 假装有内容。 */
export function supportsTextExtraction(mimeType: string): boolean {
  return (
    MINERU_DOCUMENT_MIME_TYPES.has(mimeType) ||
    PLAIN_TEXT_MIME_TYPES.has(mimeType)
  );
}

/**
 * 从已鉴权的不可变版本字节里抽取纯文本。
 *
 * 纯函数：不读数据库、不碰对象存储、不做鉴权。调用方负责在调用前完成归属校验，
 * 并把返回值作为新的文本 representation 落库。
 *
 * 失败一律抛 `AssetExtractionError` 并带稳定码——静默返回空字符串会让上层把
 * 「解析不出内容」误当成「这份资料没内容」，进而让模型基于空材料作答。
 */
export async function extractAssetText(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string> {
  if (input.mimeType === 'application/pdf') {
    return extractPdfText(input.bytes);
  }
  if (DOCX_MIME_TYPES.has(input.mimeType)) {
    return extractDocxText(input.bytes);
  }
  if (PLAIN_TEXT_MIME_TYPES.has(input.mimeType)) {
    return extractPlainText(input.bytes);
  }
  throw new AssetExtractionError('unsupported_media_type');
}

function clamp(value: string): string {
  return [...value].slice(0, ASSET_TEXT_MAX_CHARACTERS).join('');
}

/** PDF 字体映射偶尔会产出 NUL；PostgreSQL 的 text 类型拒绝该字符。 */
export function sanitizeExtractedText(value: string): string {
  return value.replace(/\u0000/gu, '');
}

function normalize(value: string): string {
  return sanitizeExtractedText(value)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    text = (await extractText(pdf, { mergePages: true })).text;
  } catch (cause) {
    throw new AssetExtractionError('pdf_text_unavailable', { cause });
  }
  const normalized = normalize(text);
  /* 空文本几乎总是扫描件，与「文件损坏」区分开，用户提示才能给出有用的下一步。 */
  if (!normalized) throw new AssetExtractionError('pdf_text_unavailable');
  return clamp(normalized);
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  let value: string;
  try {
    value = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) }))
      .value;
  } catch (cause) {
    throw new AssetExtractionError('text_content_unavailable', { cause });
  }
  const normalized = normalize(value);
  if (!normalized) throw new AssetExtractionError('text_content_unavailable');
  return clamp(normalized);
}

function extractPlainText(bytes: Uint8Array): string {
  let decoded: string;
  try {
    /* fatal 模式：非 UTF-8 必须报错而不是替换成 U+FFFD，
       否则乱码会被当成正文喂给模型。 */
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new AssetExtractionError('text_content_unavailable', { cause });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(decoded)) {
    throw new AssetExtractionError('text_content_unavailable');
  }
  const normalized = normalize(decoded.replace(/^\uFEFF/u, ''));
  if (!normalized) throw new AssetExtractionError('text_content_unavailable');
  return clamp(normalized);
}
