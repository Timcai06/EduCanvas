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
