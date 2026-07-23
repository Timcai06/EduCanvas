'use client';

import { flashcardsContentSchema } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import { ArrowCounterClockwise, Check, X } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useMemo, useRef, useState } from 'react';

gsap.registerPlugin(useGSAP);

type SelfMark = 'got' | 'missed';

/**
 * 闪卡渲染器(自评式):点击翻面,"记住了/没记住"只存在于组件内存,
 * 刷新即清零——自评不是可信学习事实,绝不上行(ADR-0006 边界)。
 */
export function FlashcardsRenderer({ content }: { content: unknown }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () => flashcardsContentSchema.safeParse(content),
    [content],
  );
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<string, SelfMark>>({});

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '[data-flashcard]',
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: 0.26, ease: 'power2.out' },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [index], revertOnUpdate: true },
  );

  if (!parsed.success) {
    return (
      <p role="alert" className="rounded-xl bg-bad-soft p-3 text-bad">
        这份闪卡的内容格式有问题，无法显示。
      </p>
    );
  }

  const cards = parsed.data.cards;
  const done = index >= cards.length;
  const gotCount = Object.values(marks).filter((mark) => mark === 'got').length;

  if (done) {
    return (
      <div
        ref={rootRef}
        className="flex h-full flex-col items-center justify-center gap-4 text-center"
      >
        <p className="text-lg font-semibold text-ink">
          本轮完成:记住 {gotCount} / {cards.length}
        </p>
        <p className="text-sm text-ink-muted">
          自评只保存在本页,不影响学习进度记录。
        </p>
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setFlipped(false);
            setMarks({});
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowCounterClockwise aria-hidden="true" size={16} />
          再来一轮
        </button>
      </div>
    );
  }

  const card = cards[index]!;
  const mark = (value: SelfMark) => {
    setMarks((current) => ({ ...current, [card.id]: value }));
    setFlipped(false);
    setIndex((current) => current + 1);
  };

  return (
    <div ref={rootRef} data-flashcards className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        data-flashcard
        onClick={() => setFlipped((value) => !value)}
        aria-label={flipped ? '显示正面' : '显示答案'}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-line/70 bg-surface/50 px-8 py-6 text-center transition-colors hover:border-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-xs font-medium text-ink-muted">
          {flipped ? '答案' : '问题 · 点击翻面'}
        </span>
        <span
          className={`text-balance ${
            flipped
              ? 'text-[15px] leading-7 text-ink-muted'
              : 'text-lg font-semibold leading-8 text-ink'
          }`}
        >
          {flipped ? card.back : card.front}
        </span>
      </button>
      <div className="flex shrink-0 items-center justify-between pt-3">
        <span className="text-xs text-ink-muted" aria-live="polite">
          {index + 1} / {cards.length}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => mark('missed')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-4 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X aria-hidden="true" size={14} />
            没记住
          </button>
          <button
            type="button"
            onClick={() => mark('got')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-good-soft px-4 text-sm font-medium text-good transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check aria-hidden="true" size={14} />
            记住了
          </button>
        </div>
      </div>
    </div>
  );
}
