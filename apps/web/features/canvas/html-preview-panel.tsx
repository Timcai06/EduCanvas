'use client';

import { CanvasHost } from './canvas-host';
import { HtmlSandbox } from './html-sandbox';

/**
 * 沙箱预览(Tier 2)Canvas 内容:模型 HTML 只在 HtmlSandbox 的隔离 iframe 中
 * 执行,不参与判分与学习事件。分栏/全屏/dialog 语义由共享 CanvasHost 提供,
 * 与判分型 CanvasPanel 是同一个宿主形态。
 */
export function HtmlPreviewPanel({
  source,
  isFull = false,
  onToggleFull,
  onClose,
}: {
  source: string;
  isFull?: boolean;
  onToggleFull?: () => void;
  onClose: () => void;
}) {
  return (
    <CanvasHost
      ariaLabel="互动内容沙箱预览"
      title="互动内容 · 沙箱预览"
      closeLabel="关闭预览"
      onClose={onClose}
      isFull={isFull}
      onToggleFull={onToggleFull}
    >
      <div className="min-h-0 flex-1 p-3">
        <HtmlSandbox source={source} title="互动内容沙箱预览" />
      </div>
    </CanvasHost>
  );
}
