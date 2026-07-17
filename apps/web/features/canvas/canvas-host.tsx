'use client';

import {
  getFocusableElements,
  makeWorkspaceBackgroundInert,
} from '@/features/workspace/shared/modal-focus';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

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
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const isModal = isFull || isCompact;

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(rootRef.current, {
          x: 32,
          autoAlpha: 0,
          duration: 0.32,
          ease: 'power2.out',
        });
      });
    },
    { scope: rootRef },
  );

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const opener = openerRef.current;
      queueMicrotask(() => opener?.focus());
    };
  }, [onClose]);

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
      role={isModal ? 'dialog' : 'region'}
      aria-label={ariaLabel}
      aria-modal={isModal || undefined}
      aria-busy={isPending}
      tabIndex={-1}
      className={`${
        isFull
          ? 'fixed inset-0 z-40 p-0 lg:p-4'
          : 'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0'
      } flex flex-col bg-surface/60 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none`}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-canvas shadow-[var(--shadow-float)] lg:rounded-3xl lg:border lg:border-line">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 lg:px-5">
          <h2 className="font-display min-w-0 flex-1 truncate text-base font-semibold text-ink">
            {title}
          </h2>
          {onToggleFull ? (
            <button
              type="button"
              onClick={onToggleFull}
              aria-label={isFull ? '退出全屏' : '全屏'}
              className="hidden min-h-9 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"
            >
              {isFull ? '退出全屏' : '全屏'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeAriaLabel ?? closeLabel}
            className="flex min-h-9 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </section>
  );
}
