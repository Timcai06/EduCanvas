'use client';

import { slidesContentSchema } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useMemo, useRef, useState } from 'react';

gsap.registerPlugin(useGSAP);

/**
 * Slides 渲染器(Tier 1 预注册组件):分页浏览 + 键盘左右翻页。
 * 与 MindMapRenderer 同一纪律:入口重过公开 Schema,坏内容显示错误不崩溃。
 */
export function SlidesRenderer({ content }: { content: unknown }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () => slidesContentSchema.safeParse(content),
    [content],
  );
  const [index, setIndex] = useState(0);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '[data-slide-body]',
          { autoAlpha: 0, x: 14 },
          { autoAlpha: 1, x: 0, duration: 0.28, ease: 'power2.out' },
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
  const go = (delta: number) =>
    setIndex((current) =>
      Math.min(slides.length - 1, Math.max(0, current + delta)),
    );

  return (
    <div
      ref={rootRef}
      data-slides
      className="flex h-full min-h-0 flex-col outline-none"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(1);
        if (event.key === 'ArrowLeft') go(-1);
      }}
    >
      <div
        data-slide-body
        className="flex min-h-0 flex-1 flex-col justify-center rounded-2xl border border-line/70 bg-surface/50 px-8 py-6"
      >
        <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
          {slide.title}
        </h3>
        {slide.bullets.length > 0 ? (
          <ul className="mt-4 space-y-2.5">
            {slide.bullets.map((bullet, bulletIndex) => (
              <li
                key={bulletIndex}
                className="flex items-start gap-2.5 text-[15px] leading-6 text-ink-muted"
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
      </div>
      <div className="flex shrink-0 items-center justify-between pt-3">
        <button
          type="button"
          aria-label="上一页"
          disabled={index === 0}
          onClick={() => go(-1)}
          className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface enabled:hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          <CaretLeft aria-hidden="true" size={18} />
        </button>
        <span className="text-xs text-ink-muted" aria-live="polite">
          {index + 1} / {slides.length}
        </span>
        <button
          type="button"
          aria-label="下一页"
          disabled={index === slides.length - 1}
          onClick={() => go(1)}
          className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface enabled:hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          <CaretRight aria-hidden="true" size={18} />
        </button>
      </div>
    </div>
  );
}
