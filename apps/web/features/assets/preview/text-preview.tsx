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
