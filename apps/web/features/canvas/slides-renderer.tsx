'use client';

import { slidesContentSchema } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import {
  CaretLeft,
  CaretRight,
  ListBullets,
  Notepad,
  X,
} from '@phosphor-icons/react';
import gsap from 'gsap';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motionDuration } from '@/features/theme/motion';
import { CanvasSurface } from './canvas-surface';
import { CanvasProgressBar } from './canvas-progress-bar';
import { KbdChip } from './kbd-chip';

gsap.registerPlugin(useGSAP);

/**
 * Slides 渲染器(Tier 1 预注册组件):分页浏览 + 键盘左右翻页 + O 总览
 * 网格 + N 备注面板(reveal.js 模式)。与 MindMapRenderer 同一纪律:
 * 入口重过公开 Schema,坏内容显示错误不崩溃。
 *
 * 键盘监听挂根元素而非 window——嵌入面板不抢全局快捷键；备注入口只在
 * deck 存在 notes 时渲染，避免给无备注的 deck 一个死按钮。
 */
export function SlidesRenderer({ content }: { content: unknown }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () => slidesContentSchema.safeParse(content),
    [content],
  );
  const [index, setIndex] = useState(0);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '[data-slide-body]',
          { autoAlpha: 0, x: 14 },
          {
            autoAlpha: 1,
            x: 0,
            duration: motionDuration('standard'),
            ease: 'power2.out',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [index], revertOnUpdate: true },
  );

  if (!parsed.success) {
    return (
      <p role="alert" className="rounded-xl bg-bad-soft p-3 text-bad">
        这份 Slides 的内容格式有问题，无法显示。
      </p>
    );
  }

  const slides = parsed.data.slides;
  const slide = slides[Math.min(index, slides.length - 1)]!;
  const hasNotes = slides.some((item) => item.notes);
  const go = (delta: number) => {
    setOverviewOpen(false);
    setIndex((current) =>
      Math.min(slides.length - 1, Math.max(0, current + delta)),
    );
  };
  const seek = (fraction: number) => {
    setIndex(Math.round(fraction * (slides.length - 1)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    /* 输入框聚焦时让位：画布同屏可能有笔记编辑器等表单 */
    const target = event.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
      return;
    }
    if (event.key === 'o' || event.key === 'O') {
      event.preventDefault();
      setOverviewOpen((value) => !value);
      return;
    }
    if (event.key === 'Escape') {
      setOverviewOpen(false);
      return;
    }
    if ((event.key === 'n' || event.key === 'N') && hasNotes) {
      event.preventDefault();
      setNotesOpen((value) => !value);
    }
  };

  return (
    <div
      ref={rootRef}
      data-slides
      className="flex h-full min-h-0 flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* scaleX 进度条：可点击跳页（reveal.js progress 的 seek 能力） */}
      <CanvasProgressBar
        value={(Math.min(index, slides.length - 1) + 1) / slides.length}
        label={`幻灯片进度：${index + 1} / ${slides.length}`}
        onSeek={seek}
        className="mb-3 shrink-0"
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {overviewOpen ? (
            <nav
              aria-label="幻灯片总览"
              className="absolute inset-0 z-10 overflow-y-auto rounded-xl border border-line/60 bg-canvas/95 p-4 backdrop-blur"
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slides.map((item, slideIndex) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={slideIndex === index}
                    onClick={() => go(slideIndex - index)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      slideIndex === index
                        ? 'border-accent bg-accent-soft/70'
                        : 'border-line/70 bg-card hover:border-accent/60'
                    }`}
                  >
                    <span className="text-[0.625rem] font-medium text-ink-faint">
                      {slideIndex + 1} / {slides.length}
                    </span>
                    <span className="line-clamp-3 block text-sm font-medium text-ink">
                      {item.title}
                    </span>
                  </button>
                ))}
              </div>
            </nav>
          ) : null}
          <CanvasSurface
            data-slide-body
            className="flex min-h-0 flex-1 flex-col justify-center"
          >
            <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
              {slide.title}
            </h3>
            {slide.bullets.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {slide.bullets.map((bullet, bulletIndex) => (
                  <li
                    key={bulletIndex}
                    className="flex items-start gap-2.5 text-body leading-6 text-ink-muted"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent/70"
                    />
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </CanvasSurface>
        </div>
        {/* 备注内嵌面板：宽屏右侧栏 / 窄屏底部（reveal.js speaker-notes 布局） */}
        {notesOpen && hasNotes ? (
          <aside
            aria-label="演讲者备注"
            data-slide-notes
            className="relative mt-3 shrink-0 overflow-y-auto rounded-xl border border-line/60 bg-surface/60 p-4 text-sm leading-6 text-ink-muted lg:mt-0 lg:ml-3 lg:w-1/4"
          >
            <button
              type="button"
              onClick={() => setNotesOpen(false)}
              aria-label="关闭备注"
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-strong hover:text-ink"
            >
              <X aria-hidden="true" size={14} />
            </button>
            <p className="mb-2 text-xs font-semibold tracking-wide text-ink-faint">
              备注 · 第 {index + 1} 页
            </p>
            {slide.notes ? (
              <p>
                <span className="whitespace-pre-wrap">{slide.notes}</span>
              </p>
            ) : (
              <p className="text-ink-faint">这一页没有备注。</p>
            )}
          </aside>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="上一页"
            disabled={index === 0}
            onClick={() => go(-1)}
            className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface enabled:hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <CaretLeft aria-hidden="true" size={18} />
          </button>
          <button
            type="button"
            aria-label="下一页"
            disabled={index === slides.length - 1}
            onClick={() => go(1)}
            className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface enabled:hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <CaretRight aria-hidden="true" size={18} />
          </button>
          {hasNotes ? (
            <button
              type="button"
              onClick={() => setNotesOpen((value) => !value)}
              aria-label={notesOpen ? '隐藏备注' : '显示备注'}
              aria-pressed={notesOpen}
              title={`备注 (${notesOpen ? '关闭' : '打开'})`}
              className={`ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                notesOpen
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-muted hover:bg-surface hover:text-ink'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            >
              <Notepad aria-hidden="true" size={15} />
              备注
              <KbdChip>N</KbdChip>
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted" aria-live="polite">
            {index + 1} / {slides.length}
          </span>
          <button
            type="button"
            onClick={() => setOverviewOpen((value) => !value)}
            aria-label={overviewOpen ? '关闭总览' : '打开总览'}
            aria-pressed={overviewOpen}
            title="总览"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              overviewOpen
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:bg-surface hover:text-ink'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            <ListBullets aria-hidden="true" size={15} />
            总览
            <KbdChip>O</KbdChip>
          </button>
        </div>
      </div>
    </div>
  );
}
