'use client';

import type { PicturebookContent } from '@educanvas/canvas-protocol';
import { ArrowLeft, ArrowRight, BookOpen } from '@phosphor-icons/react';
import Image from 'next/image';
import { useState } from 'react';

export function PicturebookRenderer({
  title,
  content,
}: {
  title: string;
  content: PicturebookContent;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = content.pages[pageIndex]!;
  const pageCount = content.pages.length;
  const goTo = (next: number) => {
    setPageIndex(Math.max(0, Math.min(next, pageCount - 1)));
  };

  return (
    <section
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
      data-testid="picturebook"
    >
      <div className="overflow-hidden rounded-[1.75rem] border border-line bg-card shadow-sm">
        <div className="relative aspect-square w-full bg-surface sm:aspect-[4/3]">
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
            <div className="flex gap-1.5" aria-hidden="true">
              {content.pages.map((_, index) => (
                <span
                  key={index}
                  className={`h-1.5 rounded-full transition-all ${
                    index === pageIndex
                      ? 'w-6 bg-accent'
                      : 'w-1.5 bg-line-strong'
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
        可使用键盘左右方向键翻页
      </p>
    </section>
  );
}
