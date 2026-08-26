'use client';

import { flashcardsContentSchema } from '@educanvas/canvas-protocol';
import {
  ArrowCounterClockwise,
  Check,
  Shuffle,
  X,
} from '@phosphor-icons/react';
import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { CanvasActionSurface } from './canvas-surface';
import { CanvasProgressBar } from './canvas-progress-bar';
import { KbdChip } from './kbd-chip';
import {
  applyMark,
  countMarks,
  createShuffledOrder,
  resolveFlashcardAction,
  type SelfMark,
} from './flashcards-renderer-model';

/**
 * 闪卡渲染器(自评式)："记住了/没记住"只存在于组件内存，刷新即清零——
 * 自评不是可信学习事实，绝不上行(ADR-0004 边界)。
 *
 * 状态机收敛为单布尔 flipped(Synapse 模式)：翻面/评分/进度全部由
 * index+flipped 派生，不存在中间态。3D 翻面用纯 CSS transform——
 * 过渡挂中层、两面 backface 隐藏；prefers-reduced-motion 下
 * motion-reduce 直接退化为瞬时切换，不另写降级分支。
 */
export function FlashcardsRenderer({ content }: { content: unknown }) {
  const parsed = useMemo(
    () => flashcardsContentSchema.safeParse(content),
    [content],
  );
  const cards = parsed.success ? parsed.data.cards : [];
  /* order 只重排本地渲染顺序，cards 数据本身不动——洗牌不产生任何持久化 */
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<string, SelfMark>>({});

  const done = index >= cards.length;
  const gotCount = countMarks(marks, 'got');
  const card = done ? null : cards[order[index]!]!;

  const shuffle = useCallback(() => {
    setOrder(createShuffledOrder(cards.length));
    setIndex(0);
    setFlipped(false);
    setMarks({});
  }, [cards.length]);

  const restart = useCallback(() => {
    setIndex(0);
    setFlipped(false);
    setMarks({});
  }, []);

  const rate = useCallback(
    (value: SelfMark) => {
      if (!card) return;
      setMarks((current) => applyMark(current, card.id, value));
      /* 先翻回正面再前进：下一张永远从问题面开始，不泄露答案 */
      setFlipped(false);
      setIndex((current) => current + 1);
    },
    [card],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      /* 输入框聚焦时让位：画布同屏可能有笔记编辑器等表单 */
      const target = event.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (!card) return;
      const action = resolveFlashcardAction(event.key, flipped);
      if (action === null) return;
      event.preventDefault();
      if (action === 'flip') setFlipped((value) => !value);
      else rate(action);
    },
    [card, flipped, rate],
  );

  if (!parsed.success) {
    return (
      <p role="alert" className="rounded-xl bg-bad-soft p-3 text-bad">
        这份闪卡的内容格式有问题，无法显示。
      </p>
    );
  }

  if (done || !card) {
    return (
      <div
        data-flashcards
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
          onClick={restart}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowCounterClockwise aria-hidden="true" size={16} />
          再来一轮
        </button>
      </div>
    );
  }

  return (
    <div
      data-flashcards
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={`闪卡 ${index + 1} / ${cards.length}，空格翻面`}
      className="flex h-full min-h-0 flex-col outline-none"
    >
      <CanvasProgressBar
        value={index / cards.length}
        label={`复习进度：${index + 1} / ${cards.length}`}
        className="mb-3 shrink-0"
      />
      {/* perspective 外层 → preserve-3d 中层管旋转 → 双面 backface 隐藏 */}
      <div className="min-h-0 flex-1 [perspective:1200px]">
        <CanvasActionSurface
          data-flashcard
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? '显示正面' : '显示答案'}
          className="relative min-h-0 h-full w-full overflow-hidden rounded-xl"
        >
          <div
            className="relative h-full w-full transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <span className="text-xs font-medium text-ink-muted">
                问题 · 点击翻面
              </span>
              <span className="text-balance text-lg leading-8 font-semibold text-ink">
                {card.front}
              </span>
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-faint">
                <KbdChip>Space</KbdChip>
                翻面
              </span>
            </div>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
              style={{
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <span className="text-xs font-medium text-ink-muted">答案</span>
              <span className="text-balance text-body leading-7 text-ink-muted">
                {card.back}
              </span>
            </div>
          </div>
        </CanvasActionSurface>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted" aria-live="polite">
            {index + 1} / {cards.length}
          </span>
          <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">
            已记住 {gotCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={shuffle}
            aria-label="打乱本轮顺序并重新开始"
            title="洗牌"
            className="inline-flex size-9 items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Shuffle aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            onClick={() => rate('missed')}
            disabled={!flipped}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-4 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X aria-hidden="true" size={14} />
            没记住
            <KbdChip>1</KbdChip>
          </button>
          <button
            type="button"
            onClick={() => rate('got')}
            disabled={!flipped}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-good-soft px-4 text-sm font-medium text-good transition-[filter,opacity] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check aria-hidden="true" size={14} />
            记住了
            <KbdChip>2</KbdChip>
          </button>
        </div>
      </div>
    </div>
  );
}
