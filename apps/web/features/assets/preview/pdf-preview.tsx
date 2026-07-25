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
