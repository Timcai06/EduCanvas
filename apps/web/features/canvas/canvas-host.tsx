'use client';

import {
  getFocusableElements,
  makeWorkspaceBackgroundInert,
} from '@/components/modal-focus';
import { motionDuration } from '@/features/theme/motion';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  buildCloseAriaLabel,
  buildCanvasHostPositionClass,
  buildFullscreenAriaLabel,
  CANVAS_CLOSE_BUTTON_CLASS,
  CANVAS_CONTENT_FRAME_CLASS,
  CANVAS_FULLSCREEN_BUTTON_CLASS,
  CANVAS_HOST_LAYOUT_CLASS,
  CANVAS_TITLE_CLASS,
  handleCanvasEscape,
} from './canvas-host-utils';

let durableCanvasOpener: HTMLElement | null = null;
let durableCanvasOpenerSelector: string | null = null;

/**
 * 分栏 Canvas 的统一宿主外壳:桌面端在对话右侧作为分栏列展开,窄屏或全屏
 * 升级为 dialog(背景 inert + 焦点陷阱),Esc 关闭并把焦点还给打开者。
 * 它不关心内容的信任层级——判分型 Artifact(Tier 1)和沙箱预览(Tier 2)
 * 使用同一个宿主,信任边界由各自的 body 组件负责。
 */

export function CanvasHost({
  ariaLabel,
  title,
  closeLabel,
  closeAriaLabel,
  onClose,
  isFull = false,
  onToggleFull,
  isPending = false,
  canExitFullscreen,
  children,
}: {
  ariaLabel: string;
  title: string;
  /** 关闭按钮的可见文案(如"返回对话"/"关闭预览")。 */
  closeLabel: string;
  /** 关闭按钮的 aria-label;缺省复用可见文案。 */
  closeAriaLabel?: string;
  onClose: () => void;
  isFull?: boolean;
  /** 缺省时不渲染全屏切换按钮。 */
  onToggleFull?: () => void;
  isPending?: boolean;
  /**
   * 覆盖「onToggleFull 存在即可退全屏」的推断。landing 强制全屏时
   * onToggleFull 是 no-op 占位，此处置 false 让 Escape 直接关闭。
   */
  canExitFullscreen?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const fullscreenRef = useRef<HTMLButtonElement>(null);
  const previousRectRef = useRef<DOMRect | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const isModal = isFull || isCompact;

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(rootRef.current, {
          x: 32,
          autoAlpha: 0,
          duration: motionDuration('standard'),
          ease: 'power2.out',
        });
      });
    },
    { scope: rootRef },
  );

  /* 分栏 ↔ 全屏的位置/尺寸连续过渡：从上一布局的 rect 补间到新 rect。
     只动 transform，reduced-motion 直接跳切。 */
  useGSAP(
    () => {
      const from = previousRectRef.current;
      const root = rootRef.current;
      if (!from || !root) return;
      const to = root.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      const scaleX = to.width > 0 ? from.width / to.width : 1;
      const scaleY = to.height > 0 ? from.height / to.height : 1;
      if (
        Math.abs(dx) < 1 &&
        Math.abs(dy) < 1 &&
        Math.abs(scaleX - 1) < 0.001 &&
        Math.abs(scaleY - 1) < 0.001
      ) {
        return;
      }
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          root,
          { x: dx, y: dy, scaleX, scaleY, transformOrigin: 'left top' },
          {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            duration: motionDuration('standard'),
            ease: 'power2.inOut',
            clearProps: 'transform',
            /* 动画结束同步终态 rect，避免后续 layout 记录混入中间帧 transform。 */
            onComplete: () => {
              previousRectRef.current = root.getBoundingClientRect();
            },
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [isFull] },
  );

  /* 声明在动效 effect 之后：layout effect 晚于前者执行，动效先读到上一布局的 rect。 */
  useLayoutEffect(() => {
    previousRectRef.current = rootRef.current?.getBoundingClientRect() ?? null;
  });

  // 打开时保存焦点来源并聚焦 Canvas；关闭时归还焦点。
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (
      durableCanvasOpener === null &&
      active !== document.body &&
      active !== document.documentElement &&
      !active?.closest('[data-canvas-host]')
    ) {
      durableCanvasOpener = active;
      durableCanvasOpenerSelector = active?.matches('[data-studio-trigger]')
        ? '[data-studio-trigger]'
        : null;
    }
    rootRef.current?.focus();
    return () => {
      queueMicrotask(() => {
        // Pending/ready Canvas hosts may replace one another in the same resource open. Preserve the
        // external opener across that handoff and restore only after the final host unmounts.
        if (document.querySelector('[data-canvas-host]')) return;
        const opener = durableCanvasOpenerSelector
          ? document.querySelector<HTMLElement>(durableCanvasOpenerSelector)
          : durableCanvasOpener?.isConnected
            ? durableCanvasOpener
            : null;
        const stableWorkspaceFallback = document.querySelector<HTMLElement>(
          '[data-studio-trigger]',
        );
        durableCanvasOpener = null;
        durableCanvasOpenerSelector = null;
        (opener ?? stableWorkspaceFallback)?.focus();
      });
    };
  }, []);

  // Escape：优先执行最小退出动作——全屏时退出全屏，非全屏时关闭。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape 已由 Canvas 消费（capture 阶段）时立即中断传播：阻止
      // conversation-sidebar 等 bubble 阶段的 Escape handler 用 rAF 抢走
      // 关闭后的焦点归还（Canvas 模态优先，Escape 只关最上层）。
      if (
        handleCanvasEscape(event, {
          isFull,
          onClose,
          onToggleFull,
          fullscreenButton: fullscreenRef.current,
          canExitFullscreen,
        })
      ) {
        event.stopImmediatePropagation();
      }
    };
    // capture 阶段注册：真实 Escape 在 bubble 阶段到达 document 时，Chrome/
    // React 合成事件系统会吞掉它（desktop 实测 cap:Escape 稳定到达而
    // bubble 的 handleKeyDown 不被触发）；capture 先于 React 委托，保证
    // Escape 一定能被 CanvasHost 处理。preventDefault 对 Escape 无副作用。
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isFull, onToggleFull, onClose, canExitFullscreen]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isModal) return;
    const root = rootRef.current;
    if (!root) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.focus();
    const restoreBackground = makeWorkspaceBackgroundInert(root);

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === root)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);

    return () => {
      document.removeEventListener('keydown', trapFocus);
      restoreBackground();
      document.body.style.overflow = previousOverflow;
    };
  }, [isModal]);

  return (
    <section
      ref={rootRef}
      data-canvas-host
      role={isModal ? 'dialog' : 'region'}
      aria-label={ariaLabel}
      aria-modal={isModal || undefined}
      aria-busy={isPending}
      tabIndex={-1}
      className={`${buildCanvasHostPositionClass(isFull)} ${CANVAS_HOST_LAYOUT_CLASS}`}
    >
      <div
        className={`flex min-h-0 flex-1 flex-col bg-canvas ${
          isFull
            ? ''
            : 'shadow-[var(--shadow-float)] lg:rounded-3xl lg:border lg:border-line'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 lg:px-5">
          <h2 className={CANVAS_TITLE_CLASS}>{title}</h2>
          {onToggleFull ? (
            <button
              ref={fullscreenRef}
              type="button"
              onClick={onToggleFull}
              aria-label={buildFullscreenAriaLabel(isFull)}
              className={CANVAS_FULLSCREEN_BUTTON_CLASS}
            >
              {buildFullscreenAriaLabel(isFull)}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={buildCloseAriaLabel(closeAriaLabel, closeLabel)}
            className={CANVAS_CLOSE_BUTTON_CLASS}
          >
            {closeLabel}
          </button>
        </div>
        <div className={CANVAS_CONTENT_FRAME_CLASS}>{children}</div>
      </div>
    </section>
  );
}
