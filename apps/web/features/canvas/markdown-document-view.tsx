'use client';

import type { NoteContent } from '@educanvas/canvas-protocol';
import { useEffect, useRef, useState } from 'react';
import { NoteRenderer } from './note-renderer';
import { CanvasProgressBar } from './canvas-progress-bar';
import {
  dedupeSlug,
  pickActiveHeading,
  slugifyHeading,
} from './markdown-toc-model';

type TocEntry = { id: string; text: string; level: number };

const HEADING_SELECTOR = 'h1, h2, h3, h4';
/** 目录少于该数量时不显示：两三个标题的文档不需要导航。 */
const MIN_HEADINGS_FOR_TOC = 3;
/** 点击目录跳转后暂停 spy 的时长：平滑滚动期间高亮不抖动（tocbot isClick 模式）。 */
const SPY_PAUSE_MS = 700;

/**
 * markdown_document 产物的只读查看器：NoteRenderer 只读路径 +
 * 阅读进度条 + 右侧 TOC（scroll-spy 高亮当前章节）。
 *
 * 目录数据从**已渲染 DOM**读取而非解析原始 markdown——避免与
 * react-markdown 的渲染结果出现两套不一致的结构。id 缺失时补写，
 * 已有 id（未来插件生成）原样复用。
 */
export function MarkdownDocumentView({ content }: { content: NoteContent }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const spyPauseUntilRef = useRef(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const article = wrapper.querySelector('article');
    if (!article) return;

    /* 补齐/复用标题锚点，构建目录条目 */
    const used = new Map<string, number>();
    const headings = Array.from(
      article.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
    );
    const entries: TocEntry[] = headings.map((heading) => {
      if (!heading.id) {
        heading.id =
          dedupeSlug(slugifyHeading(heading.textContent ?? ''), used) ||
          `section-${used.size}`;
      }
      return {
        id: heading.id,
        text: heading.textContent ?? '',
        level: Number(heading.tagName.slice(1)),
      };
    });
    setToc(entries);
    setActiveId(entries[0]?.id ?? null);

    /* 滚动容器是 article 的直接父级（note-renderer 的 overflow-y-auto 层） */
    const scroller = article.parentElement;
    if (!scroller) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollable = scroller.scrollHeight - scroller.clientHeight;
      setProgress(scrollable > 0 ? scroller.scrollTop / scrollable : 0);
      const scrollerTop = scroller.getBoundingClientRect().top;
      /* tops 相对滚动容器内容顶部：rect 差值 + scrollTop 还原到内容坐标 */
      const tops = headings.map(
        (heading) =>
          heading.getBoundingClientRect().top -
          scrollerTop +
          scroller.scrollTop,
      );
      if (Date.now() < spyPauseUntilRef.current) return;
      const activeIndex = pickActiveHeading(tops, scroller.scrollTop);
      setActiveId(entries[activeIndex]?.id ?? null);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [content]);

  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    spyPauseUntilRef.current = Date.now() + SPY_PAUSE_MS;
    setActiveId(id);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div ref={wrapperRef} className="relative flex min-h-0 flex-1">
      <CanvasProgressBar
        value={progress}
        label="阅读进度"
        className="absolute inset-x-0 top-0 z-10 rounded-none bg-transparent"
      />
      <div className="min-h-0 min-w-0 flex-1">
        <NoteRenderer content={content} isLatest readOnly showChrome={false} />
      </div>
      {toc.length >= MIN_HEADINGS_FOR_TOC ? (
        <nav
          aria-label="文档目录"
          data-markdown-toc
          className="hidden w-56 shrink-0 overflow-y-auto border-l border-line/70 py-4 pr-2 pl-3 xl:block"
        >
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-faint">
            目录
          </p>
          <ul className="space-y-1">
            {toc.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(entry.id)}
                  aria-current={activeId === entry.id}
                  style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}
                  className={`block w-full truncate rounded-lg py-1 pr-2 text-left text-xs transition-colors ${
                    activeId === entry.id
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ink-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
