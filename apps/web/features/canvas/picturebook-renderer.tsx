'use client';

import type { PicturebookContent } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import { ArrowLeft, ArrowRight, BookOpen } from '@phosphor-icons/react';
import gsap from 'gsap';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { motionDuration } from '@/features/theme/motion';
import { useSwipeGesture } from './use-swipe-gesture';

gsap.registerPlugin(useGSAP);

/**
 * 绘本渲染器（StPageFlip 调研结论的克制落地）：不引入翻书依赖，
 * 翻页用方向感知的入场动画（旋转+位移，模拟硬页绕书脊翻起）；
 * swipe 用三条件阈值；相邻页预加载消除翻页白屏。
 * prefers-reduced-motion 下 gsap.matchMedia 不注册动画，退化为直切。
 */
export function PicturebookRenderer({
  title,
  content,
}: {
  title: string;
  content: PicturebookContent;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  /* 方向感知：入场动画从操作方向侧滑入，翻上一页/下一页观感不同 */
  const directionRef = useRef(1);
  const page = content.pages[pageIndex]!;
  const pageCount = content.pages.length;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(next, pageCount - 1));
    if (clamped === pageIndex) return;
    directionRef.current = clamped > pageIndex ? 1 : -1;
    setPageIndex(clamped);
  };

  const swipe = useSwipeGesture({
    onSwipeLeft: () => goTo(pageIndex + 1),
    onSwipeRight: () => goTo(pageIndex - 1),
  });

  /* 相邻页预加载：翻页时图片已在缓存，不再白屏闪烁 */
  useEffect(() => {
    for (const offset of [1, -1]) {
      const neighbor = content.pages[pageIndex + offset];
      if (!neighbor) continue;
      const img = new window.Image();
      img.src = neighbor.imageUrl;
    }
  }, [content.pages, pageIndex]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const from = directionRef.current;
        gsap.fromTo(
          '[data-picturebook-page]',
          { autoAlpha: 0, rotateY: from * -14, x: from * 28 },
          {
            autoAlpha: 1,
            rotateY: 0,
            x: 0,
            duration: motionDuration('standard'),
            ease: 'power2.out',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [pageIndex], revertOnUpdate: true },
  );

  return (
    <section
      ref={rootRef}
      className="mx-auto w-full max-w-4xl outline-none"
      aria-label={`${title} 绘本`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goTo(pageIndex - 1);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(pageIndex + 1);
        }
      }}
      {...swipe}
      data-testid="picturebook"
    >
      <div className="overflow-hidden rounded-[1.75rem] border border-line bg-card shadow-sm">
        {/* 书脊渐变阴影：一条左侧 gradient 就有「书」的质感（StPageFlip 借鉴点） */}
        <div
          className="relative aspect-square w-full bg-surface sm:aspect-[4/3]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(48 42 24 / 0.08), transparent 6%)',
          }}
        >
          <div data-picturebook-page className="absolute inset-0">
            <Image
              key={page.imageUrl}
              src={page.imageUrl}
              alt={page.captionText}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, 896px"
              className="object-cover"
              priority={pageIndex === 0}
            />
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-[6%]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgb(48 42 24 / 0.1), transparent)',
              }}
              aria-hidden="true"
            />
          </div>
          <div className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-full bg-card/90 px-3 py-1.5 text-xs font-semibold text-ink shadow-sm backdrop-blur">
            <BookOpen aria-hidden="true" weight="duotone" />第 {pageIndex + 1}{' '}
            页 / 共 {pageCount} 页
          </div>
        </div>
        <div className="px-5 py-5 sm:px-8 sm:py-7">
          <p
            className="font-display min-h-14 text-center text-lg leading-8 font-medium text-ink sm:text-xl"
            aria-live="polite"
          >
            {page.captionText}
          </p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => goTo(pageIndex - 1)}
              disabled={pageIndex === 0}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-line bg-card px-4 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="上一页"
            >
              <ArrowLeft aria-hidden="true" />
              <span className="hidden sm:inline">上一页</span>
            </button>
            <div className="flex gap-1.5" role="tablist" aria-label="绘本页码">
              {content.pages.map((_, dotIndex) => (
                <button
                  key={dotIndex}
                  type="button"
                  role="tab"
                  aria-selected={dotIndex === pageIndex}
                  aria-label={`第 ${dotIndex + 1} 页`}
                  onClick={() => goTo(dotIndex)}
                  className={`h-1.5 rounded-full transition-all ${
                    dotIndex === pageIndex
                      ? 'w-6 bg-accent'
                      : 'w-1.5 bg-line-strong hover:bg-ink-faint'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => goTo(pageIndex + 1)}
              disabled={pageIndex === pageCount - 1}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
              aria-label="下一页"
            >
              <span className="hidden sm:inline">下一页</span>
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-ink-faint">
        可使用键盘左右方向键或滑动翻页
      </p>
    </section>
  );
}
