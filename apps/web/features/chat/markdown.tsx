'use client';

import { isPreviewableHtml } from '@/features/canvas/sandbox-preview';
import { CodeBlock, Play } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface HtmlPreviewRequest {
  source: string;
}

/**
 * 助手消息的 Markdown 渲染层。安全边界：
 * - 不引入 rehype-raw,原始 HTML 一律不渲染(react-markdown 默认跳过);
 * - ```html 代码块不执行,而是渲染为"沙箱预览"产物卡,点击后由宿主决定
 *   在哪个面（Sheet/Canvas）里用 HtmlSandbox 执行——遵循 ADR-0010 Tier 2;
 * - 链接强制 rel="noreferrer" 新窗口打开,不携带 referrer。
 */
export function MessageMarkdown({
  text,
  onPreviewHtml,
}: {
  text: string;
  onPreviewHtml?: (request: HtmlPreviewRequest) => void;
}) {
  return (
    <div className="chat-prose min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const language = /language-(\w+)/.exec(className ?? '')?.[1];
            const source = String(children ?? '').replace(/\n$/, '');
            const isBlock = className !== undefined || source.includes('\n');
            if (!isBlock) {
              return <code className="chat-prose__inline-code">{source}</code>;
            }
            if (
              onPreviewHtml &&
              isPreviewableHtml(language ?? null, source)
            ) {
              return (
                <HtmlPreviewCard
                  source={source}
                  onPreview={() => onPreviewHtml({ source })}
                />
              );
            }
            return (
              <CodeFence language={language ?? null}>{source}</CodeFence>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeFence({
  language,
  children,
}: {
  language: string | null;
  children: ReactNode;
}) {
  return (
    <div className="chat-prose__code-block">
      {language ? (
        <span className="chat-prose__code-lang">{language}</span>
      ) : null}
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** 消息流内的沙箱预览产物卡:先显示来源摘要,执行永远发生在用户显式点击之后。 */
function HtmlPreviewCard({
  source,
  onPreview,
}: {
  source: string;
  onPreview: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPreview}
      className="group my-1 flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-surface/70 p-3 text-left shadow-[var(--shadow-float)] transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
      >
        <CodeBlock size={21} weight="regular" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          互动内容
        </span>
        <span className="block text-xs text-ink-muted">
          沙箱预览 · {Math.max(1, Math.round(source.length / 1024))} KB
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent">
        运行
        <Play aria-hidden="true" size={13} weight="fill" />
      </span>
    </button>
  );
}
