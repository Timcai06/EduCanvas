'use client';

import { useGSAP } from '@gsap/react';
import { X } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import {
  getFocusableElements,
  makeWorkspaceBackgroundInert,
} from './modal-focus';

/**
 * 右侧抽屉（桌面）/ 底部抽屉（窄屏）的统一外壳：dialog 语义、Esc 与遮罩关闭、
 * 打开时移焦进入、关闭时归还焦点。同屏最多一个 Sheet，由 LearnWorkspace 保证互斥。
 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const fromVars =
          window.innerWidth < 1024 ? { yPercent: 12 } : { xPercent: 8 };
        gsap.from(panelRef.current, {
          ...fromVars,
          autoAlpha: 0,
          duration: 0.24,
          ease: 'power2.out',
        });
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
        onCloseRef.current();
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
  }, []);

  return (
    <div ref={rootRef} className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭面板"
        onClick={onClose}
        className="absolute inset-0 size-full cursor-default bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col overscroll-contain rounded-t-3xl border border-line/80 bg-canvas/98 shadow-[var(--shadow-sheet)] outline-none lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-96 lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-lg font-semibold text-ink">
            {label}
          </h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X aria-hidden="true" size={18} weight="bold" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
