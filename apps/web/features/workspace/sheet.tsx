'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef } from 'react';

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
    panelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div ref={rootRef} className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭面板"
        onClick={onClose}
        className="absolute inset-0 size-full cursor-default bg-ink/20"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col rounded-t-3xl bg-canvas shadow-[var(--shadow-sheet)] outline-none lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-96 lg:rounded-none"
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
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
