import { getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

/** Worker 在读取对象前与读取后都必须执行的输入上限。 */
export const ASSET_PREVIEW_MAX_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * 预览渲染的字符上限。
 *
 * HTML 预览用于快速展示，不需要完整内容。截断保证大文档不会
 * 产生超大 HTML 片段进入对象存储或浏览器 DOM。
 */
export const ASSET_PREVIEW_MAX_CHARACTERS = 200_000;

/**
 * 稳定失败码。它们会落进 `asset_processing_jobs.failure_code`，
 * 并被 HTTP 层映射成用户文案，因此只能追加、不能改写含义。
 */
export const assetPreviewFailureCodes = [
  /** PDF 结构损坏或无法解析第一页。 */
  'pdf_preview_unavailable',
  /** DOCX 转换失败或内容为空。 */
  'docx_preview_unavailable',
  /** MIME 不在本包的支持范围内，调用方不该把它排进预览队列。 */
  'unsupported_media_type',
  /** 输入超过服务端预览策略上限。 */
  'preview_input_too_large',
] as const;

export type AssetPreviewFailureCode = (typeof assetPreviewFailureCodes)[number];

export class AssetPreviewError extends Error {
  override readonly name = 'AssetPreviewError';

  constructor(
    readonly code: AssetPreviewFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml',
]);

/** 调用方据此判断某个版本要不要排进预览队列。 */
export function supportsPreviewRendering(mimeType: string): boolean {
  return mimeType === 'application/pdf' || DOCX_MIME_TYPES.has(mimeType);
}

export interface PreviewRenderResult {
  /** HTML 片段，可直接注入浏览器 DOM。 */
  html: string;
  /** 渲染的 MIME 类型。 */
  mimeType: 'text/html';
}

/**
 * 从已鉴权的不可变版本字节里渲染 HTML 预览。
 *
 * 纯函数：不读数据库、不碰对象存储、不做鉴权。调用方负责在调用前完成归属校验，
 * 并把返回值作为新的 preview representation 落库。
 *
 * 失败一律抛 `AssetPreviewError` 并带稳定码——静默返回空字符串会让上层把
 * 「渲染失败」误当成「文件没有内容」。
 */
export async function renderAssetPreview(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<PreviewRenderResult> {
  if (input.mimeType === 'application/pdf') {
    return renderPdfPreview(input.bytes);
  }
  if (DOCX_MIME_TYPES.has(input.mimeType)) {
    return renderDocxPreview(input.bytes);
  }
  throw new AssetPreviewError('unsupported_media_type');
}

function clamp(value: string): string {
  return [...value].slice(0, ASSET_PREVIEW_MAX_CHARACTERS).join('');
}

/**
 * 渲染 PDF 第一页为 HTML。
 *
 * 使用 unpdf 提取文本并包装为 HTML 结构。对于纯图片 PDF，
 * 提取的文本可能为空，此时返回一个占位提示。
 */
async function renderPdfPreview(
  bytes: Uint8Array,
): Promise<PreviewRenderResult> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const firstPage = await pdf.getPage(1);
    const content = await firstPage.getTextContent();
    text = content.items
      .map((item) => {
        if ('str' in item) return item.str;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  } catch (cause) {
    throw new AssetPreviewError('pdf_preview_unavailable', { cause });
  }

  const normalized = text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    // 纯图片 PDF 或扫描件，返回占位提示
    return {
      html: '<div class="pdf-preview-empty">此 PDF 需要 OCR 才能显示文本内容</div>',
      mimeType: 'text/html',
    };
  }

  const html = `<div class="pdf-preview">${escapeHtml(clamp(normalized))}</div>`;
  return { html, mimeType: 'text/html' };
}

/**
 * 将 DOCX 转换为浏览器安全的 HTML。
 *
 * DOCX 是不可信上传内容。Mammoth 的富文本 HTML 不是安全净化器，不能直接送入
 * `dangerouslySetInnerHTML`。这里只抽取纯文本、转义后包装为 `<pre>`；需要富文本
 * 样式时必须另行引入经过审计的 allowlist sanitizer。
 */
async function renderDocxPreview(
  bytes: Uint8Array,
): Promise<PreviewRenderResult> {
  let value: string;
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    value = result.value;
  } catch (cause) {
    throw new AssetPreviewError('docx_preview_unavailable', { cause });
  }

  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    throw new AssetPreviewError('docx_preview_unavailable');
  }

  return {
    html: `<pre class="docx-preview">${escapeHtml(clamp(normalized))}</pre>`,
    mimeType: 'text/html',
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
