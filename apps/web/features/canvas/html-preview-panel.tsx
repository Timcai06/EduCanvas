'use client';

import { useGSAP } from '@gsap/react';
import { X } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { HtmlSandbox } from './html-sandbox';

/**
 * 沙箱预览的同界面分栏容器(Gemini Canvas 式):桌面端在对话右侧展开一列,
 * 窄屏升级为全屏浮层。它只是 Tier 2 沙箱的宿主外壳,不参与判分与学习事件;
 * K12 判分型 Artifact 仍由 CanvasPanel 承载。
 */
export function HtmlPreviewPanel({
  source,
  onClose,
}: {
  source: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          root,
          { autoAlpha: 0, xPercent: 6 },
          { autoAlpha: 1, xPercent: 0, duration: 0.32, ease: 'power3.out' },
        );
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(root, { autoAlpha: 1, xPercent: 0 });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <section
      ref={rootRef}
      aria-label="互动内容沙箱预览"
      className="fixed inset-0 z-40 flex flex-col bg-canvas lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:border-l lg:border-line/70 lg:bg-canvas/60"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line/70 px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          互动内容 · 沙箱预览
        </h2>
        <button
          type="button"
          aria-label="关闭预览"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X aria-hidden="true" size={18} weight="bold" />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <HtmlSandbox source={source} title="互动内容沙箱预览" />
      </div>
    </section>
  );
}
