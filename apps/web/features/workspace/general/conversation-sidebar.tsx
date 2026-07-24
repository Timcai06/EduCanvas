'use client';

import { switchConversationAction } from '@/app/actions';
import { useGSAP } from '@gsap/react';
import { ChatCircle, Plus, Trash } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useRef, useState, useTransition } from 'react';

gsap.registerPlugin(useGSAP);

interface NotebookListItem {
  id: string;
  title: string | null;
  lastActivityAt: string;
}

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

/**
 * Notebook 侧栏：可展开的抽屉层（学习 Gemini/GPT/Claude 的 Web 交互）。
 * 桌面端在流内折叠（收起时宽度归零、内容占满全宽），窄屏为覆盖抽屉 + 遮罩。
 * 不再永久占位——由 header 的汉堡按钮控制开合，状态由 workspace 持有并记忆。
 * 只消费公开投影；切换经 Server Action 校验归属后写游标，浏览器不持有会话密钥。
 */
export function ConversationSidebar({
  open,
  onClose,
  activeConversationId,
  onNewNotebook,
  children,
}: {
  open: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  onNewNotebook: () => void;
  /** 侧栏底部扩展区（来源面板等）。 */
  children?: React.ReactNode;
}) {
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [items, setItems] = useState<readonly NotebookListItem[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isSwitchPending, startSwitchTransition] = useTransition();

  useEffect(() => {
    if (!open) return;

    const opener = document.querySelector<HTMLButtonElement>(
      '[aria-controls="conversation-sidebar"]',
    );
    const openedFromTrigger = document.activeElement === opener;
    const focusFrame = window.requestAnimationFrame(() => {
      if (openedFromTrigger) firstActionRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            '[aria-controls="conversation-sidebar"]',
          )
          ?.focus();
      });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  const closeAndRestoreFocus = () => {
    onClose();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[aria-controls="conversation-sidebar"]',
        )
        ?.focus();
    });
  };

  const deleteConversation = async (conversationId: string) => {
    if (!window.confirm('删除这条历史记录？')) return;
    const response = await fetch(
      `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) return;
    setItems((current) =>
      current.filter((conversation) => conversation.id !== conversationId),
    );
    if (conversationId === activeConversationId) window.location.assign('/');
  };

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/chat/conversations')
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              conversations: NotebookListItem[];
            })
          : { conversations: [] },
      )
      .then((data) => {
        if (active) setItems(data.conversations);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeConversationId, open]);

  useGSAP(
    () => {
      if (!open) return;
      const rows = listRef.current
        ? Array.from(
            listRef.current.querySelectorAll<HTMLElement>(
              '[data-sidebar-item]',
            ),
          )
        : [];
      if (rows.length === 0) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          rows,
          { autoAlpha: 0, x: -6 },
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.28,
            stagger: 0.03,
            ease: 'power2.out',
          },
        );
      });
      return () => media.revert();
    },
    {
      scope: listRef,
      dependencies: [items.length, open],
      revertOnUpdate: true,
    },
  );

  return (
    <>
      {/* 窄屏遮罩：点击关闭，桌面端不出现 */}
      {open ? (
        <button
          type="button"
          aria-label="关闭笔记本列表"
          onClick={closeAndRestoreFocus}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      ) : null}
      {/*
       * 外层控制开合：桌面端折叠为 0 宽（内容占满全宽），窄屏为固定覆盖抽屉。
       * 内层固定 w-64 以免折叠动画时正文重排。
       */}
      <nav
        id="conversation-sidebar"
        aria-label="笔记本"
        aria-hidden={!open}
        inert={!open}
        className={`z-40 shrink-0 overflow-hidden border-line/60 bg-canvas transition-[width,transform] duration-300 ease-out ${
          open
            ? 'w-72 translate-x-0 border-r lg:w-64'
            : 'w-72 -translate-x-full border-r-0 lg:w-0'
        } fixed inset-y-0 left-0 lg:static lg:inset-auto lg:translate-x-0`}
      >
        <div className="flex h-full w-72 flex-col lg:w-64">
          <div className="px-3 pt-3 pb-1.5">
            <button
              ref={firstActionRef}
              type="button"
              onClick={onNewNotebook}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-full bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus aria-hidden="true" size={16} weight="bold" />
              新建笔记本
            </button>
          </div>
          <p className="px-5 pt-3 pb-1 text-xs font-medium text-ink-muted">
            笔记本
          </p>
          <ul
            ref={listRef}
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
          >
            {items.map((item) => {
              const isActive = item.id === activeConversationId;
              return (
                <li key={item.id} data-sidebar-item>
                  <div
                    className={`group flex min-h-9 items-center rounded-full pr-1 transition-colors ${
                      isActive
                        ? 'bg-accent-soft text-ink'
                        : 'text-ink-muted hover:bg-surface hover:text-ink'
                    } ${pendingId === item.id ? 'opacity-60' : ''}`}
                  >
                    <button
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      disabled={isSwitchPending}
                      onClick={() => {
                        if (isActive) return;
                        setPendingId(item.id);
                        startSwitchTransition(async () => {
                          try {
                            await switchConversationAction(item.id);
                          } finally {
                            setPendingId(null);
                          }
                        });
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <ChatCircle
                        aria-hidden="true"
                        size={14}
                        className="shrink-0 text-ink-faint"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.title ?? '未命名笔记本'}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-muted">
                        {formatWhen(item.lastActivityAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="删除历史记录"
                      title="删除历史记录"
                      onClick={() => void deleteConversation(item.id)}
                      className="grid size-7 shrink-0 place-items-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-cinnabar-soft hover:text-cinnabar-strong focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
                    >
                      <Trash aria-hidden="true" size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
            {items.length === 0 ? (
              <li className="px-3 py-2 text-xs text-ink-muted">还没有笔记本</li>
            ) : null}
          </ul>
          {children}
        </div>
      </nav>
    </>
  );
}
