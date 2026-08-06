'use client';

import { useGSAP } from '@gsap/react';
import { X } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useCallback, useEffect, useRef } from 'react';
import { motionDuration } from '@/features/theme/motion';
import {
  getFocusableElements,
  makeWorkspaceBackgroundInert,
} from './modal-focus';

/**
 * 统一抽屉外壳。桌面：一页从右侧浮起、四周留白的圆角纸页（不再贴边全高的板子）；
 * 窄屏：底部抽屉。dialog 语义、Esc 与遮罩关闭、打开移焦进入、关闭归还焦点。
 * 同屏最多一个 Sheet，由调用方保证互斥。
 *
 * 版式身份（对齐「两支笔」/ ai-name）：英文小 eyebrow + 衬线大标题 + 克制留白；
 * 入场是遮罩淡入 + 纸页滑起 + 前缘墨紫竖线自上而下拉起 + 内容分条 stagger 浮现；
 * 关闭走同一条 timeline 反向播放再卸载。reduced-motion 下退化为瞬时开合。
 *
 * 内容作者可给需要依次浮现的块加 `data-sheet-item`；没有时默认对页眉与正文两段做
 * stagger。关闭必须走 onClose（动画结束后才回调），触发关闭处不要自己立刻卸载面板。
 */
export function Sheet({
  label,
  eyebrow,
  stableHeight = false,
  onClose,
  children,
}: {
  label: string;
  /** 标题上方的英文小标签（大写字距），给抽屉一点扉页感；可省略。 */
  eyebrow?: string;
  /** 异步内容较多时固定可视高度，避免数据返回后整张纸页上下跳动。 */
  stableHeight?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const accentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** 关闭：有入场 timeline 时反向播放到底再卸载，否则（reduced-motion）立即回调。 */
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const timeline = timelineRef.current;
    if (!timeline) {
      onCloseRef.current();
      return;
    }
    timeline
      .eventCallback('onReverseComplete', () => onCloseRef.current())
      .timeScale(1.45)
      .reverse();
  }, []);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const isMobile = window.innerWidth < 1024;
        const panelFrom = isMobile ? { yPercent: 14 } : { xPercent: 6, y: 10 };
        const items = panelRef.current?.querySelectorAll('[data-sheet-item]');
        const staggerTargets =
          items && items.length > 0
            ? items
            : [headerRef.current, bodyRef.current].filter(Boolean);

        const timeline = gsap
          .timeline({ defaults: { ease: 'power3.out' } })
          .fromTo(
            overlayRef.current,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: motionDuration('fast') },
          )
          .fromTo(
            panelRef.current,
            { ...panelFrom, autoAlpha: 0 },
            {
              xPercent: 0,
              yPercent: 0,
              y: 0,
              autoAlpha: 1,
              duration: motionDuration('slow'),
            },
            0,
          )
          .fromTo(
            accentRef.current,
            { scaleY: 0 },
            { scaleY: 1, duration: motionDuration('slow') },
            0.16,
          )
          .fromTo(
            staggerTargets,
            { autoAlpha: 0, y: 16 },
            {
              autoAlpha: 1,
              y: 0,
              duration: motionDuration('emphasis'),
              stagger: 0.06,
            },
            0.18,
          );
        timelineRef.current = timeline;
        return () => {
          timeline.kill();
          timelineRef.current = null;
        };
      });
    },
    { scope: rootRef },
  );

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const restoreBackground = rootRef.current
      ? makeWorkspaceBackgroundInert(rootRef.current)
      : () => undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreBackground();
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [requestClose]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:justify-end lg:p-5"
    >
      <button
        ref={overlayRef}
        type="button"
        aria-label="关闭面板"
        onClick={requestClose}
        className="absolute inset-0 size-full cursor-default bg-ink/35 backdrop-blur-[3px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] border border-line/70 bg-card shadow-[var(--shadow-sheet)] outline-none will-change-transform lg:max-h-[calc(100dvh-2.5rem)] lg:w-[27rem] lg:rounded-[1.75rem] ${
          stableHeight ? 'h-[86dvh] lg:h-[calc(100dvh-2.5rem)]' : ''
        }`}
      >
        {/* 前缘墨紫竖线：抽屉的「讲课笔」签名，入场自上而下拉起 */}
        <div
          ref={accentRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px] origin-top bg-accent"
        />
        <div
          ref={headerRef}
          className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 sm:px-8 sm:pt-8"
        >
          <div>
            {eyebrow ? (
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
              {label}
            </h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={requestClose}
            className="group grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X
              aria-hidden="true"
              size={17}
              weight="bold"
              className="transition-transform duration-300 group-hover:rotate-90"
            />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto px-6 pb-7 pt-1 sm:px-8"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
