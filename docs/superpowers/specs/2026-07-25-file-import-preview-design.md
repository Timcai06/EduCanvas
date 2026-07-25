# 文件导入与预览功能设计

**日期**: 2026-07-25
**状态**: 已批准，待实现

## 概述

为 EduCanvas 新增 DOCX、MD、TXT 文件上传支持，加上现有 PDF 共 4 种格式均可上传、文本提取、侧栏预览。预览面板复用 CanvasHost 分屏槽位。

## 格式支持矩阵

| 格式 | MIME Type | 文本提取 | 预览渲染 | 依赖 |
|------|-----------|----------|----------|------|
| PDF | application/pdf | unpdf（已有） | pdf.js 渲染（新增） | pdfjs-dist |
| DOCX | application/vnd.openxmlformats-officedocument.wordprocessingml | mammoth 提取（新增） | mammoth → HTML 内嵌渲染（新增） | mammoth |
| MD | text/markdown | 读 UTF-8 原文（新增） | react-markdown 渲染（新增） | react-markdown（已有） |
| TXT | text/plain | 读 UTF-8 原文（新增） | 等宽字体 pre-wrap 渲染（新增） | 无 |

## 架构

```
SourcesPanel (点击文件)
  → FilePreviewPanel (右侧分屏，复用 CanvasHost 槽位)
    → PdfPreview / DocxPreview / MarkdownPreview / TextPreview
```

预览面板与现有 Canvas 面板互斥——共享同一个分屏槽位。

## 后端变更

### 文件检测扩展

`detectFile()` 新增魔术字/MIME：

| 格式 | 检测方式 |
|------|----------|
| DOCX | `PK\x03\x04` + 文件名后缀 .docx + MIME 校验 |
| MD | `.md` / `.markdown` 后缀 |
| TXT | `.txt` 后缀 + `text/plain` MIME |

### 文本提取新增

```typescript
// MD/TXT：直接读 UTF-8
function extractPlainText(bytes: Uint8Array): string
  → new TextDecoder('utf-8').decode(bytes)
  → normalize + trim + truncate(MAX_EXTRACTED_TEXT)

// DOCX：mammoth 提取
function extractDocxText(bytes: Buffer): Promise<string>
  → mammoth.extractRawText({ buffer: bytes })
  → normalize + trim + truncate(MAX_EXTRACTED_TEXT)
```

### 预览 API

```
GET /api/v1/chat/assets/:id/preview
  → 返回 { mimeType, content, rendered? }
  → PDF: { mimeType: 'application/pdf', url: /api/v1/chat/assets/:id/file }
  → DOCX: { mimeType: 'text/html', content: '<html>...' } (服务端 mammoth 转)
  → MD: { mimeType: 'text/markdown', content: '...' }
  → TXT: { mimeType: 'text/plain', content: '...' }
```

### 文件原始数据 API

```
GET /api/v1/chat/assets/:id/file
  → 返回原始文件 bytes（Content-Type: ... + Content-Disposition: inline）
  → PDF 预览用，pdf.js 需要完整文件
```

## 前端变更

### 新增文件

| 文件 | 职责 |
|------|------|
| `features/assets/file-preview-panel.tsx` | 预览面板外壳，路由到具体 renderer |
| `features/assets/preview/pdf-preview.tsx` | pdf.js 渲染 PDF |
| `features/assets/preview/docx-preview.tsx` | 内嵌 HTML 渲染 DOCX |
| `features/assets/preview/markdown-preview.tsx` | react-markdown 渲染 MD |
| `features/assets/preview/text-preview.tsx` | 等宽 pre-wrap 渲染 TXT |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/assets/asset-upload.ts` | detectFile 加 DOCX/MD/TXT，加 extractDocxText/extractPlainText |
| `app/api/v1/chat/assets/route.ts` | 扩展上传 accept，加 preview 端点 |
| `app/api/v1/chat/assets/[id]/...` | 加 preview + file 子路由 |
| `features/assets/asset-client.ts` | 加 fetchAssetPreview + fetchAssetFile |
| `features/assets/asset-upload-panel.tsx` | accept 加 .docx,.md,.txt |
| `features/assets/assets-drawer.tsx` | 文件项点击 → onPreview |
| `features/workspace/general/sources-panel.tsx` | 文件项点击 → 打开预览面板 |
| `features/workspace/general/general-chat-workspace.tsx` | 加预览面板槽位 |
| `features/workspace/learning/learn-workspace.tsx` | 加预览面板槽位 |
| `featuress/composer/plus-menu.tsx` | 上传文件 accept 扩展 |

### FilePreviewPanel 行为

- 从右侧滑入（复用 CanvasHost 的 40:60 分栏）
- 顶部：文件名 + 格式标签 + 关闭按钮
- 内容区：根据 MIME 类型选择 renderer
- 底部可选：「将此文件加入当前对话上下文」按钮

## 范围边界

- V1 不做 DOC（旧二进制格式）
- V1 不做 OCR（扫描件 PDF 显示「无文本层 PDF」）
- V1 不做文件编辑
- V1 不做文件下载导出
- V1 不做 Excel/PPT 预览
