'use client';

import { useEffect, useRef } from 'react';
import { NotebookDirectory } from './notebook-directory';
import { useConversationSidebarMotion } from './use-conversation-sidebar-motion';
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useResizableSidebar,
} from './use-resizable-sidebar';

/** Notebook 选择和子对话共享抽屉；保留键盘关闭、焦点恢复及宽度调整。 */
export function ConversationSidebar({
  open,
  onClose,
  activeConversationId,
  notebookId,
}: {
  open: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  notebookId?: string;
  onNewNotebook: () => void;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resize = useResizableSidebar();
  useConversationSidebarMotion({
    open,
    width: resize.width,
    sidebarRef,
    panelRef,
  });
  const close = () => {
    onClose();
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[aria-controls="conversation-sidebar"]',
        )
        ?.focus(),
    );
  };
  useEffect(() => {
    if (!open) return;
    const opener = document.querySelector(
      '[aria-controls="conversation-sidebar"]',
    );
    const fromTrigger = document.activeElement === opener;
    const frame = window.requestAnimationFrame(() => {
      if (fromTrigger) closeRef.current?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        window.requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>(
              '[aria-controls="conversation-sidebar"]',
            )
            ?.focus(),
        );
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="关闭笔记本列表"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={close}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        id="conversation-sidebar"
        aria-label="笔记本侧栏"
        aria-hidden={!open}
        inert={!open}
        style={resize.style}
        className={`z-40 shrink-0 overflow-hidden border-line bg-canvas ${open ? 'w-72 border-r lg:w-[var(--sidebar-width)]' : 'w-72 -translate-x-full border-r-0 lg:w-0'} fixed inset-y-0 left-0 lg:static lg:inset-auto lg:translate-x-0`}
      >
        <div
          ref={panelRef}
          className="h-full w-72 overflow-y-auto overscroll-contain lg:w-[var(--sidebar-width)]"
        >
          <button
            ref={closeRef}
            type="button"
            className="m-3 min-h-11 rounded-full px-4 text-sm focus-visible:ring-2 focus-visible:ring-accent"
            onClick={close}
          >
            收起列表
          </button>
          {notebookId ? (
            <NotebookDirectory
              notebookId={notebookId}
              conversationId={activeConversationId ?? undefined}
            />
          ) : null}
        </div>
        {open ? (
          <div
            role="separator"
            aria-label="调整笔记本列表宽度"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_WIDTH_MIN}
            aria-valuemax={SIDEBAR_WIDTH_MAX}
            aria-valuenow={resize.width}
            tabIndex={0}
            {...resize.separatorProps}
            className="absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-accent/20 focus-visible:bg-accent/30 lg:block"
          />
        ) : null}
      </aside>
    </>
  );
}
