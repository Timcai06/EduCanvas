'use client';

import { X } from '@phosphor-icons/react';
import { useEffect } from 'react';

/**
 * Studio 的非模态展开面。它贴住浏览器右边缘并保留主对话上下文，不制造遮罩、
 * 焦点陷阱或独立页面；具体输入/输出能力由 children 提供。
 */
export function StudioDock({
  expanded,
  onClose,
  children,
}: {
  expanded: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <aside
      id="notebook-studio-dock"
      aria-label="当前笔记本的 Studio"
      data-expanded={expanded}
      className={`fixed right-0 top-16 z-30 overflow-x-hidden transition-[width,height,background-color,box-shadow] duration-500 ease-out ${
        expanded
          ? 'bottom-0 w-full overflow-y-auto border-l border-t border-line/70 bg-canvas px-4 pb-5 pt-12 shadow-[-22px_18px_60px_color-mix(in_srgb,var(--color-ink)_16%,transparent)] sm:px-6 lg:w-[min(62vw,62rem)] lg:border-t-0 lg:px-8'
          : 'h-[30rem] w-full max-w-[32rem] overflow-hidden bg-transparent px-0 pb-0 pt-0 shadow-none'
      }`}
    >
      <button
        type="button"
        aria-label="收起 Studio"
        onClick={onClose}
        className="absolute right-5 top-4 z-20 grid size-10 place-items-center rounded-full border border-line bg-card/75 text-ink-muted backdrop-blur transition-colors hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X aria-hidden="true" size={17} weight="bold" />
      </button>
      {children}
    </aside>
  );
}
