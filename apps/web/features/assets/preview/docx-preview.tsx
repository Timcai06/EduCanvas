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
