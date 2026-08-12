'use client';

import dynamic from 'next/dynamic';
import type { AssetPreview } from './asset-preview-contract';
import {
  ReadingViewSwitcher,
  resolveReadingAvailability,
} from './reading-view-switcher';

/** pdf.js 依赖浏览器 Canvas API，禁止 SSR */
const PdfPreview = dynamic(
  () => import('./preview/pdf-preview').then((mod) => mod.PdfPreview),
  { ssr: false },
);

type PdfPreviewData = Extract<AssetPreview, { kind: 'pdf' }>;

/** 兼容别名：representation 决策与文件类型无关，docx 复用同一函数。 */
export { resolveReadingAvailability as resolvePdfReadingAvailability };

/** ADR-0026 决定 6 的 PDF 阅读入口：默认原件 pdf.js 预览，共享壳负责切换。 */
export function PdfReadingSwitcher({
  preview,
  initialView,
}: {
  preview: PdfPreviewData;
  initialView?: 'original' | 'structured';
}) {
  return (
    <ReadingViewSwitcher
      representation={preview.representation}
      initialView={initialView}
      renderOriginal={() => <PdfPreview fileUrl={preview.fileUrl} />}
    />
  );
}
