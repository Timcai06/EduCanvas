# 文件导入与预览 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 EduCanvas 新增 DOCX、MD、TXT 文件上传支持，并为 PDF、DOCX、MD、TXT 四种格式提供侧栏预览面板。

**Architecture:** 后端扩展现有 asset-upload 通道（detectFile + 文本提取），新增 preview API 端点；前端新增 FilePreviewPanel 壳 + 4 个格式渲染器，复用 CanvasHost 分屏槽位。

**Tech Stack:** TypeScript, Next.js, mammoth, pdfjs-dist, react-markdown, GSAP

**Design Doc:** `docs/superpowers/specs/2026-07-25-file-import-preview-design.md`

## Global Constraints

- 上传文件大小上限 10MB（已有 MAX_UPLOAD_BYTES，不动）
- 提取文本上限 120,000 字符（已有 MAX_EXTRACTED_TEXT，不动）
- 新增依赖：mammoth (DOCX 提取 + HTML 转换), pdfjs-dist (PDF 客户端渲染)
- react-markdown + remark-gfm 已安装（被 note-renderer 使用）
- 预览面板与 Canvas 面板互斥共用分屏槽位
- 每行代码加 JSDoc 注释说明意图和边界条件（ai-friendly-codebase 规范）

---

### Task 1: 安装依赖

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: 无
- Produces: `mammoth`, `pdfjs-dist` 在 web 包可用

- [ ] **Step 1: 安装 mammoth + pdfjs-dist**

```bash
cd apps/web && pnpm add mammoth pdfjs-dist
```

mammoth 版本约束 `^1.8.0`，pdfjs-dist 版本约束 `^4.9.0`。pnpm 自动锁定。

- [ ] **Step 2: 验证类型声明可用**

Run: `pnpm --filter web exec tsc --noEmit --moduleResolution bundler 2>&1 | grep -c "mammoth\|pdfjs-dist"`
Expected: 0（无类型找不到错误）

- [ ] **Step 3: Commit（不执行，记录用）**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "chore: add mammoth and pdfjs-dist for file preview"
```

---

### Task 2: 后端——扩展 detectFile + 新增文本提取器

**Files:**
- Modify: `apps/web/server/assets/asset-upload.ts`

**Interfaces:**
- Consumes: `mammoth` 库
- Produces: `detectFile` 支持 DOCX/MD/TXT；`extractDocxText`、`extractPlainText` 函数

- [ ] **Step 1: 顶部新增 mammoth 导入**

```typescript
// apps/web/server/assets/asset-upload.ts 第5行
import { extractText, getDocumentProxy } from 'unpdf';
// 新增:
import mammoth from 'mammoth';
```

- [ ] **Step 2: 扩展 DetectedFile 类型支持 MD/TXT**

```typescript
// 第40-44行，DetectedFile 接口
interface DetectedFile {
  /** 资产主类别——docx 归入 document 走文本提取链路 */
  kind: 'image' | 'document';
  /** 精确 MIME 类型，预览面板据此选择 renderer */
  mimeType: string;
  /** 文件扩展名，不含点号 */
  extension: string;
}
```

类型已兼容——DOCX 归入 `document`，`mimeType` 区分 `application/pdf` vs `application/vnd.openxmlformats-officedocument.wordprocessingml`，MD/TXT 也用 `document` kind + 各自 mime。

- [ ] **Step 3: detectFile() 新增 DOCX 魔术字**

```typescript
// 在 detectFile() 内，WEBP 检测之后、return null 之前
// DOCX: PK zip + 内部文件名校验
// DOCX 文件本质是 ZIP 压缩包（PK\x03\x04 开头），
// 但这与普通 ZIP 无法区分，因此额外检查文件内部路径。
if (
  bytes.length >= 4 &&
  bytes[0] === 0x50 && // 'P'
  bytes[1] === 0x4b && // 'K'
  bytes[2] === 0x03 &&
  bytes[3] === 0x04
) {
  // 检查 ZIP 内是否包含 docx 关键路径 [Content_Types].xml
  const header = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(bytes.length, 4096)));
  if (header.includes('[Content_Types].xml')) {
    return {
      kind: 'document',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml',
      extension: 'docx',
    };
  }
  // 无法确认为 DOCX 的 ZIP 文件——不匹配后续后缀检测规则，返回 null 让调用方拒绝
}
```

- [ ] **Step 4: detectFile() 新增 MD/TXT 后缀检测**

```typescript
// detectFile() 底部，所有魔术字判断之后、return null 之前

/*
 * Markdown / 纯文本没有可靠魔术字，回退到文件后缀检测。
 * 服务端无法无限制扩展，优先检出高价值类型（DOCX/MD/TXT），
 * 其余交回调用方的 unsupported_file_type 统一拒绝。
 */
function detectPlainTextFile(fileName: string): DetectedFile | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return {
      kind: 'document',
      mimeType: 'text/markdown',
      extension: 'md',
    };
  }
  if (lower.endsWith('.txt')) {
    return {
      kind: 'document',
      mimeType: 'text/plain',
      extension: 'txt',
    };
  }
  return null;
}
```

新增 `detectPlainTextFile` 导出函数。在 `uploadOwnedAssetToSpace` 中（第139行 `const detected = detectFile(bytes)` 之后），加回退：

```typescript
const detected = detectFile(bytes) ?? detectPlainTextFile(input.file.name);
```

- [ ] **Step 5: 新增 extractDocxText() 函数**

```typescript
/**
 * 使用 mammoth 从 DOCX 提取纯文本。
 * DOCX 本质是 ZIP 内嵌 XML，mammoth 负责解析 WordprocessingML。
 * @param bytes - DOCX 原始字节
 * @returns 提取的纯文本，截断至 MAX_EXTRACTED_TEXT
 * @throws {AssetUploadError} 提取失败时抛出 docx_text_unavailable
 */
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes);
  let result;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (cause) {
    throw new AssetUploadError('docx_text_unavailable', 422, { cause });
  }
  const normalized = result.value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) {
    throw new AssetUploadError('docx_text_unavailable', 422);
  }
  return [...normalized].slice(0, MAX_EXTRACTED_TEXT).join('');
}
```

注意：AssetUploadError 构造函数现有签名 `(code, status)`——需要扩展支持 `cause`。修改：

```typescript
// 第24-37行
export class AssetUploadError extends Error {
  constructor(
    readonly code:
      | 'invalid_upload'
      | 'unsupported_file_type'
      | 'file_too_large'
      | 'session_not_found'
      | 'pdf_text_unavailable'
      | 'docx_text_unavailable'
      | `link_${string}`,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'AssetUploadError';
  }
}
```

- [ ] **Step 6: 新增 extractPlainText() 函数**

```typescript
/**
 * 从 UTF-8 编码的字节中提取纯文本（MD/TXT）。
 * 自动处理 BOM（U+FEFF）和不同平台换行符。
 * @param bytes - 原始 UTF-8 字节
 * @returns 提取并规范化的文本内容
 */
function extractPlainText(bytes: Uint8Array): string {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const normalized = decoded
    .replace(/^﻿/, '') // 去掉 UTF-8 BOM
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
  return [...normalized].slice(0, MAX_EXTRACTED_TEXT).join('');
}
```

- [ ] **Step 7: uploadOwnedAssetToSpace 中按 mime 分派提取器**

```typescript
// 第153-155行，替换：
//   const extractedText =
//     detected.kind === 'document' ? await extractPdfText(bytes) : null;
// 为：
const extractedText =
  detected.kind === 'document'
    ? detected.mimeType === 'application/pdf'
      ? await extractPdfText(bytes)
      : detected.mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml'
        ? await extractDocxText(bytes)
        : extractedPlainText // MD/TXT：外部已调用 extractPlainText
    : null;
```

但 `extractPlainText` 对 MD/TXT 是同步的，需要在调用处统一处理。重构：

```typescript
// 第139-155行逻辑调整为：
const detected = detectFile(bytes) ?? detectPlainTextFile(input.file.name);
if (!detected) throw new AssetUploadError('unsupported_file_type', 415);
if (input.file.type && input.file.type.toLowerCase() !== detected.mimeType) {
  // MD/TXT 的浏览器 MIME 可能为 text/plain 甚至空字符串，放宽校验：
  // 只有当服务端判定为 image/pdf/docx 且与浏览器报告不一致时才拒绝
  const isTextBased =
    detected.mimeType === 'text/markdown' ||
    detected.mimeType === 'text/plain';
  if (!isTextBased) {
    throw new AssetUploadError('unsupported_file_type', 415);
  }
  // 文本类文件：信任服务端检测，不依赖浏览器 MIME
}

// ... storeAssetBytes ...

let extractedText: string | null = null;
if (detected.kind === 'document') {
  if (detected.mimeType === 'application/pdf') {
    extractedText = await extractPdfText(bytes);
  } else if (
    detected.mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml'
  ) {
    extractedText = await extractDocxText(bytes);
  } else if (
    detected.mimeType === 'text/markdown' ||
    detected.mimeType === 'text/plain'
  ) {
    // 同步路径：MD/TXT 直接读 UTF-8
    const text = extractPlainText(bytes);
    extractedText = text || null;
    if (!extractedText) {
      throw new AssetUploadError('pdf_text_unavailable', 422);
      // 复用 pdf_text_unavailable code——UI 显示"无文本内容"
      // 后续可改为独立 code
    }
  }
}
```

- [ ] **Step 8: 更新错误消息文案**

```typescript
// apps/web/server/assets/asset-upload-http.ts 第53行
case 'unsupported_file_type':
  return '目前支持 PDF、DOCX、Markdown 和纯文本文件。如需更多格式请反馈。';
case 'docx_text_unavailable':
  return '这个 DOCX 文件无法提取文本，请确认文件未损坏。';
```

- [ ] **Step 9: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 类型错误

---

### Task 3: 后端——新增预览 API 端点

**Files:**
- Create: `apps/web/app/api/v1/chat/assets/[assetId]/preview/route.ts`
- Create: `apps/web/app/api/v1/chat/assets/[assetId]/file/route.ts`

**Interfaces:**
- Consumes: asset storage, mammoth (服务端 DOCX→HTML)
- Produces: `GET /preview` 返回 { mimeType, content?, url? }；`GET /file` 返回原始文件

- [ ] **Step 1: 创建 file 端点（原始文件流）**

```typescript
// apps/web/app/api/v1/chat/assets/[assetId]/file/route.ts
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { jsonError } from '@/server/http/request-security';
import { DrizzleAssetRepository } from '@educanvas/db';
import { readStoredAssetBytes } from '@/server/assets/asset-storage';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 获取资产原始文件二进制数据。PDF 用 pdf.js 客户端渲染需要完整文件流。
 * 越权同 404——不泄露资产是否存在。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) {
    return jsonError(404, 'asset_not_found', '文件不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const repository = new DrizzleAssetRepository();
    const snapshots = await repository.listOwnedSpace({
      ownerSubjectId: identity.studentId,
      spaceId: conversation.spaceId,
    });
    const snapshot = snapshots.find((s) => s.id === assetId);
    if (!snapshot || !snapshot.storageKey) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }
    const result = await readStoredAssetBytes(snapshot.storageKey);
    if (!result) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }
    return new Response(result.bytes, {
      headers: {
        'Content-Type': snapshot.mimeType ?? 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(snapshot.displayName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return jsonError(503, 'asset_read_unavailable', '暂时无法读取文件。');
  }
}
```

- [ ] **Step 2: 创建 preview 端点（预览元数据 + 内容）**

```typescript
// apps/web/app/api/v1/chat/assets/[assetId]/preview/route.ts
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { jsonError } from '@/server/http/request-security';
import { DrizzleAssetRepository } from '@educanvas/db';
import { readStoredAssetBytes } from '@/server/assets/asset-storage';
import mammoth from 'mammoth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 预览元数据响应。
 * - PDF: 返回 file URL（客户端用 pdf.js 渲染）
 * - DOCX: 服务端 mammoth 转 HTML 后返回 content
 * - MD/TXT: 返回提取的原始文本 content
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) {
    return jsonError(404, 'asset_not_found', '文件不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const repository = new DrizzleAssetRepository();
    const snapshots = await repository.listOwnedSpace({
      ownerSubjectId: identity.studentId,
      spaceId: conversation.spaceId,
    });
    const snapshot = snapshots.find((s) => s.id === assetId);
    if (!snapshot) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }

    const mimeType = snapshot.mimeType ?? 'application/octet-stream';
    const fileName = snapshot.displayName;

    // PDF: 返回 file URL，客户端用 pdf.js 渲染
    if (mimeType === 'application/pdf') {
      return Response.json({
        mimeType,
        fileName,
        fileUrl: `/api/v1/chat/assets/${encodeURIComponent(assetId)}/file`,
      });
    }

    // DOCX: 服务端 mammoth 转 HTML
    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml'
    ) {
      if (!snapshot.storageKey) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const result = await readStoredAssetBytes(snapshot.storageKey);
      if (!result) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const htmlResult = await mammoth.convertToHtml({
        buffer: Buffer.from(result.bytes),
      });
      return Response.json({
        mimeType,
        fileName,
        content: htmlResult.value,
        /** mammoth 产生的警告信息，可用于诊断格式兼容性 */
        warnings: htmlResult.messages.map((m) => m.message),
      });
    }

    // MD / TXT: 返回提取文本
    if (mimeType === 'text/markdown' || mimeType === 'text/plain') {
      if (!snapshot.storageKey) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const result = await readStoredAssetBytes(snapshot.storageKey);
      if (!result) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const content = new TextDecoder('utf-8').decode(result.bytes);
      return Response.json({ mimeType, fileName, content });
    }

    // 其他格式（如图片）：暂不支持预览
    return jsonError(415, 'preview_unsupported', '暂不支持此格式的预览。');
  } catch {
    return jsonError(503, 'preview_unavailable', '暂时无法加载预览。');
  }
}
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 类型错误

---

### Task 4: 前端——预览 Renderer 组件（4 个）

**Files:**
- Create: `apps/web/features/assets/preview/pdf-preview.tsx`
- Create: `apps/web/features/assets/preview/docx-preview.tsx`
- Create: `apps/web/features/assets/preview/markdown-preview.tsx`
- Create: `apps/web/features/assets/preview/text-preview.tsx`

**Interfaces:**
- Consumes: 预览 API 返回的 data
- Produces: 4 个 React 组件，each 接受标准 props

- [ ] **Step 1: PdfPreview——pdf.js 渲染**

```typescript
// apps/web/features/assets/preview/pdf-preview.tsx
'use client';

import * as pdfjs from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';

/** pdf.js worker 从 CDN 加载，避免 bundler 复杂度 */
pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs';

/**
 * 使用 pdf.js 逐页渲染 PDF 的客户端预览组件。
 * @param fileUrl - 服务端文件流端点（GET /api/v1/chat/assets/:id/file）
 */
export function PdfPreview({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.2);
  const pdfDoc = useRef<pdfjs.PDFDocumentProxy | null>(null);

  const renderPage = useCallback(
    async (pageNum: number, doc: pdfjs.PDFDocumentProxy) => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = '';
      try {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.className = 'mx-auto shadow-sm rounded-lg';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
        container.appendChild(canvas);
      } catch {
        setError(`第 ${pageNum} 页渲染失败。`);
      }
    },
    [scale],
  );

  useEffect(() => {
    let cancelled = false;
    const loadAndRender = async () => {
      try {
        const doc = await pdfjs.getDocument(fileUrl).promise;
        if (cancelled) return;
        pdfDoc.current = doc;
        setPageCount(doc.numPages);
        setCurrentPage(1);
        await renderPage(1, doc);
      } catch {
        if (!cancelled) {
          setError(
            'PDF 文件可能已损坏或为扫描件（无文本层），无法预览。',
          );
        }
      }
    };
    void loadAndRender();
    return () => {
      cancelled = true;
    };
  }, [fileUrl, renderPage]);

  const goToPage = useCallback(
    (page: number) => {
      if (!pdfDoc.current || page < 1 || page > pageCount) return;
      setCurrentPage(page);
      void renderPage(page, pdfDoc.current);
    },
    [pageCount, renderPage],
  );

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-ink-muted" role="alert">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pageCount > 1 ? (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-line px-4 py-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
            className="min-h-8 rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-ink-muted">
            {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            disabled={currentPage >= pageCount}
            onClick={() => goToPage(currentPage + 1)}
            className="min-h-8 rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface disabled:opacity-40"
          >
            下一页
          </button>
          <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(s + 0.2, 2.5))}
            className="min-h-8 rounded-full px-2 text-sm text-ink-muted transition-colors hover:bg-surface"
            title="放大"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(s - 0.2, 0.6))}
            className="min-h-8 rounded-full px-2 text-sm text-ink-muted transition-colors hover:bg-surface"
            title="缩小"
          >
            −
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto p-4"
      />
    </div>
  );
}
```

- [ ] **Step 2: DocxPreview——内嵌 HTML 渲染**

```typescript
// apps/web/features/assets/preview/docx-preview.tsx
'use client';

import { Warning } from '@phosphor-icons/react';

/**
 * 展示 mammoth 转换的 DOCX HTML 内容。
 * 内嵌在安全的 div 中（非 iframe）——mammoth HTML 仅含文本样式标签（h1/p/li/b），
 * 无 script 或外部资源，可信任。
 */
export function DocxPreview({
  html,
  warnings,
}: {
  html: string;
  warnings?: string[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {warnings && warnings.length > 0 ? (
        <div className="mx-4 mt-3 rounded-xl border border-line bg-surface px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Warning size={14} className="shrink-0 text-caution" />
            格式提示
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-ink-muted">
            {warnings.slice(0, 3).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <article
        className="prose prose-sm max-w-none p-5 dark:prose-invert"
        /*
         * mammoth 输出的 HTML 不含危险标签，使用 dangerouslySetInnerHTML 是安全的——
         * 所有内容来自服务端 mammoth 库，不经过用户输入。
         */
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
```

- [ ] **Step 3: MarkdownPreview——react-markdown 渲染**

```typescript
// apps/web/features/assets/preview/markdown-preview.tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 文件预览——复用 note-renderer 同款 react-markdown + remark-gfm。
 * 只读模式，无编辑工具栏。
 */
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <article className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
```

- [ ] **Step 4: TextPreview——等宽 pre-wrap 渲染**

```typescript
// apps/web/features/assets/preview/text-preview.tsx
'use client';

/**
 * 纯文本文件预览——等宽字体 + 保留换行与缩进。
 * pre-wrap 比 pre 更好：长行自动换行不产生横向滚动，仍保留原有换行和空白。
 */
export function TextPreview({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-ink">
        {content}
      </pre>
    </div>
  );
}
```

- [ ] **Step 5: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 类型错误

---

### Task 5: 前端——FilePreviewPanel 壳组件 + asset-client 扩展

**Files:**
- Create: `apps/web/features/assets/file-preview-panel.tsx`
- Modify: `apps/web/features/assets/asset-client.ts`

- [ ] **Step 1: 扩展 asset-client 加预览 API 调用**

```typescript
// apps/web/features/assets/asset-client.ts 底部新增

/** 预览 API 返回的数据结构 */
export interface PreviewData {
  mimeType: string;
  fileName: string;
  content?: string;
  fileUrl?: string;
  warnings?: string[];
}

const previewDataSchema = z.object({
  mimeType: z.string(),
  fileName: z.string().optional(),
  content: z.string().optional(),
  fileUrl: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

/**
 * 获取资产的预览数据。
 * PDF 返回 fileUrl，DOCX 返回 mammoth HTML content，MD/TXT 返回文本 content。
 * @param assetId - 资产 UUID
 * @param endpoint - 预览 API 端点 URL
 */
export async function fetchAssetPreview(
  assetId: string,
  endpoint?: string,
): Promise<PreviewData> {
  const url =
    endpoint ??
    `/api/v1/chat/assets/${encodeURIComponent(assetId)}/preview`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      response.status === 415
        ? '暂不支持预览此文件格式。'
        : '暂时无法加载预览。',
    );
  }
  const parsed = previewDataSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('预览响应格式不正确。');
  return parsed.data;
}
```

- [ ] **Step 2: 创建 FilePreviewPanel 壳组件**

```typescript
// apps/web/features/assets/file-preview-panel.tsx
'use client';

import { CanvasHost } from '@/features/canvas/canvas-host';
import { useCallback, useEffect, useState } from 'react';
import { fetchAssetPreview, type PreviewData } from './asset-client';
import { PdfPreview } from './preview/pdf-preview';
import { DocxPreview } from './preview/docx-preview';
import { MarkdownPreview } from './preview/markdown-preview';
import { TextPreview } from './preview/text-preview';
import type { AssetItem } from './assets-drawer';

/**
 * 文件预览面板——复用 CanvasHost 分屏槽位（与 Canvas 面板互斥）。
 * 加载完成后根据 MIME 类型分派到对应 renderer。
 *
 * 状态机：idle → loading → ready | error
 */
export function FilePreviewPanel({
  asset,
  isFull = false,
  onToggleFull,
  onClose,
}: {
  asset: { id: string; label: string };
  isFull?: boolean;
  onToggleFull?: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (assetId: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAssetPreview(assetId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(asset.id);
  }, [asset.id, load]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8" aria-busy="true">
          <p className="text-sm text-ink-muted">正在准备预览…</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="text-sm text-ink-muted" role="alert">
            {error}
          </p>
        </div>
      );
    }
    if (!data) return null;

    const { mimeType } = data;
    if (mimeType === 'application/pdf' && data.fileUrl) {
      return <PdfPreview fileUrl={data.fileUrl} />;
    }
    if (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml' &&
      data.content
    ) {
      return (
        <DocxPreview html={data.content} warnings={data.warnings} />
      );
    }
    if (mimeType === 'text/markdown' && data.content !== undefined) {
      return <MarkdownPreview content={data.content} />;
    }
    if (mimeType === 'text/plain' && data.content !== undefined) {
      return <TextPreview content={data.content} />;
    }
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-ink-muted">暂不支持预览此文件格式。</p>
      </div>
    );
  };

  return (
    <CanvasHost
      ariaLabel={`${asset.label} 预览`}
      title={asset.label}
      closeLabel="关闭预览"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
    >
      {renderContent()}
    </CanvasHost>
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 类型错误

---

### Task 6: 前端——扩展现有组件支持多格式上传

**Files:**
- Modify: `apps/web/features/assets/asset-upload-panel.tsx`
- Modify: `apps/web/features/assets/assets-drawer.tsx`
- Modify: `apps/web/features/workspace/general/sources-panel.tsx`

- [ ] **Step 1: AssetUploadPanel accept 扩展**

```typescript
// apps/web/features/assets/asset-upload-panel.tsx 第32-33行
// 替换为：
const accept =
  kind === 'image'
    ? 'image/png,image/jpeg,image/webp'
    : '.pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml,text/markdown,text/plain';
```

同时更新文案（第75-81行）：
```typescript
kind === 'image'
  ? ...
  : fixedScope === 'space'
    ? '支持 PDF、DOCX、Markdown 和纯文本，最大10MB。文字会在服务端解析并成为当前笔记本的长期来源。'
    : '支持 PDF、DOCX、Markdown 和纯文本，最大10MB。上传后文字会在服务端解析并作为受控附件进入对话。'
```

- [ ] **Step 2: AssetsDrawer 加 onPreview prop**

```typescript
// apps/web/features/assets/assets-drawer.tsx
// Props 新增:
// onPreview?: (assetId: string) => void;

// 每个 <li> 的 label 内加点击预览：
//   onClick={() => asset.selectable && onPreview?.(asset.id)}
```

- [ ] **Step 3: SourcesPanel 文件项加点击预览 + 上传按钮扩展**

```typescript
// sources-panel.tsx Props 新增:
// onPreview?: (asset: AssetItem) => void;

// 每个 label 修改：加 onClick 跳到预览
// <label onClick={() => onPreview?.(asset)} ...>

// 上传按钮（第59-65行）："上传 PDF" 改为 "上传文件"，accept 扩展
```

- [ ] **Step 4: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 类型错误

---

### Task 7: 前端——Workspace 层面接线

**Files:**
- Modify: `apps/web/features/workspace/general/general-chat-workspace.tsx`
- Modify: `apps/web/features/workspace/learning/learn-workspace.tsx`

- [ ] **Step 1: GeneralChatWorkspace 加预览面板槽位**

```typescript
// general-chat-workspace.tsx

// 新增 import:
import { FilePreviewPanel } from '@/features/assets/file-preview-panel';

// 新增 state:
const [previewAsset, setPreviewAsset] = useState<{ id: string; label: string } | null>(null);
const [previewFull, setPreviewFull] = useState(false);

// previewAsset 非 null 时，显示 FilePreviewPanel
// 放在 Canvas / HtmlPreviewPanel 同位置（替换它们）
// 与 canvasOpen / previewHtml 互斥

// SourcesPanel 新增 onPreview prop
```

```typescript
// 在 SourcesPanel 使用处（第312行附近）：
<SourcesPanel
  assets={notebookSources}
  onToggle={toggleAsset}
  onUpload={(kind) => setAssetPanel(kind)}
  onPreview={(asset) => {
    // 关闭其他面板后打开预览
    setCanvasSelected(false);
    setPreviewHtml(null);
    setPreviewAsset({ id: asset.id, label: asset.label });
  }}
  onImported={...}
/>

// 在渲染区（previewHtml 的 else if 块之后）：
{previewAsset ? (
  <FilePreviewPanel
    asset={previewAsset}
    isFull={previewFull}
    onToggleFull={() => setPreviewFull((v) => !v)}
    onClose={() => {
      setPreviewAsset(null);
      setPreviewFull(false);
    }}
  />
) : null}
```

- [ ] **Step 2: LearnWorkspace 同模式接线**

```typescript
// learn-workspace.tsx —— 相同的 previewAsset state 模式
// previewAsset 与 canvasOpen 互斥（打开预览时关闭 Canvas，反之亦然）
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 类型错误

---

### Task 8: 类型检查 + 测试回归

- [ ] **Step 1: 全项目类型检查**

```bash
pnpm typecheck
```
Expected: 21/21 包通过

- [ ] **Step 2: 单元测试**

```bash
pnpm test
```
Expected: 所有已有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add DOCX/MD/TXT upload and file preview panel

- Extend detectFile for DOCX/MD/TXT formats
- Add extractDocxText (mammoth) and extractPlainText (UTF-8)
- Add preview API (GET /assets/:id/preview) with format dispatch
- Add file serving API (GET /assets/:id/file) for pdf.js
- Add PdfPreview (pdf.js), DocxPreview (mammoth HTML), MarkdownPreview, TextPreview
- Add FilePreviewPanel shell reusing CanvasHost
- Wire preview into SourcesPanel, AssetsDrawer, and both workspaces
- Expand upload accept to .pdf,.docx,.md,.txt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 实现顺序依赖图

```
Task 1 (deps)
  └─> Task 2 (backend detect + extract)
        ├─> Task 3 (preview + file API)
        │     └─> Task 5 (FilePreviewPanel)
        └─> Task 6 (upload panel + sources)
Task 4 (renderers)
  └─> Task 5 (FilePreviewPanel)
Task 5 + Task 6
  └─> Task 7 (workspace wiring)
ALL
  └─> Task 8 (verify)
```

Task 2 和 Task 4 可并行。
