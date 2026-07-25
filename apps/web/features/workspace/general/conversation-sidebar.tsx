'use client';

import { switchConversationAction } from '@/app/actions';
import LineSidebar from '@/components/LineSidebar';
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  groupNotebooksByRecency,
  type NotebookListItem,
} from './notebook-groups';
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useResizableSidebar,
} from './use-resizable-sidebar';

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
 *
 * 列表用统一的旁注导航（编号 + 发丝标记线 + 邻近感应），删除做成尾部 hover 浮现的动作。
 */
export function ConversationSidebar({
  open,
  onClose,
  activeConversationId,
  onNewNotebook,
}: {
  open: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  onNewNotebook: () => void;
}) {
  const router = useRouter();
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<readonly NotebookListItem[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [isSwitchPending, startSwitchTransition] = useTransition();
  const sidebarResize = useResizableSidebar();

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

  const switchTo = (conversationId: string) => {
    if (conversationId === activeConversationId || isSwitchPending) return;
    setPendingId(conversationId);
    startSwitchTransition(async () => {
      try {
        await switchConversationAction(conversationId);
      } finally {
        setPendingId(null);
      }
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

  const renameConversation = async (item: NotebookListItem) => {
    const currentTitle = item.title ?? '未命名笔记本';
    const requested = window.prompt('命名笔记本', currentTitle);
    if (requested === null) return;
    const title = requested.normalize('NFC').trim();
    if (!title || title.length > 120) {
      window.alert('笔记本名称应为 1 到 120 个字符。');
      return;
    }
    if (title === currentTitle) return;

    setRenamingId(item.id);
    try {
      const response = await fetch(
        `/api/v1/chat/conversations/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) {
        window.alert('暂时无法保存笔记本名称，请稍后重试。');
        return;
      }
      setItems((current) =>
        current.map((conversation) =>
          conversation.id === item.id
            ? { ...conversation, title }
            : conversation,
        ),
      );
      if (item.id === activeConversationId) router.refresh();
    } finally {
      setRenamingId(null);
    }
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

  const groups = groupNotebooksByRecency(items, new Date());

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
      <aside
        id="conversation-sidebar"
        aria-label="笔记本侧栏"
        aria-hidden={!open}
        inert={!open}
        style={sidebarResize.style}
        className={`z-40 shrink-0 overflow-hidden border-line/60 bg-canvas transition-[width,transform] duration-300 ease-out ${
          open
            ? 'w-72 translate-x-0 border-r lg:w-[var(--sidebar-width)]'
            : 'w-72 -translate-x-full border-r-0 lg:w-0'
        } fixed inset-y-0 left-0 lg:static lg:inset-auto lg:translate-x-0`}
      >
        <div className="flex h-full w-72 flex-col lg:w-[var(--sidebar-width)]">
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
          <p className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Notebooks
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {groups.length > 0 ? (
              <div className="flex flex-col gap-1">
                {groups.map((group) => {
                  const groupActiveIndex = group.items.findIndex(
                    (item) => item.id === activeConversationId,
                  );
                  return (
                    <section key={group.key} aria-label={group.label}>
                      {/* 时间近度小标题：发丝分隔线 + 极淡标签，作为长列表的查找锚点 */}
                      <p className="flex items-center gap-2.5 px-5 pb-1 pt-3 text-[11px] font-medium tracking-wide text-ink-faint">
                        <span className="shrink-0">{group.label}</span>
                        <span
                          aria-hidden="true"
                          className="h-px flex-1 bg-line/60"
                        />
                      </p>
                      <LineSidebar
                        ariaLabel={group.label}
                        items={group.items.map(
                          (item) => item.title ?? '未命名笔记本',
                        )}
                        itemIds={group.items.map((item) => item.id)}
                        activeIndex={
                          groupActiveIndex >= 0 ? groupActiveIndex : null
                        }
                        disabled={isSwitchPending}
                        accentColor="var(--color-accent)"
                        textColor="var(--color-ink-muted)"
                        markerColor="var(--color-line)"
                        proximityRadius={92}
                        maxShift={16}
                        falloff="smooth"
                        markerLength={24}
                        tickScale={0.42}
                        itemGap={2}
                        fontSize={0.88}
                        smoothing={100}
                        onItemClick={(index) => {
                          const item = group.items[index];
                          if (item) switchTo(item.id);
                        }}
                        renderLabel={(index, label) => {
                          const item = group.items[index];
                          return (
                            <span
                              className={`flex min-w-0 items-start gap-2 ${
                                pendingId === item?.id ? 'opacity-60' : ''
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {label}
                              </span>
                              <span className="shrink-0 pt-0.5 text-[11px] text-ink-muted">
                                {item ? formatWhen(item.lastActivityAt) : ''}
                              </span>
                            </span>
                          );
                        }}
                        renderAction={(index) => {
                          const item = group.items[index];
                          return item ? (
                            <span className="flex items-center gap-0.5">
                              <button
                                type="button"
                                aria-label="命名笔记本"
                                title="命名笔记本"
                                disabled={renamingId === item.id}
                                onClick={() => void renameConversation(item)}
                                className="grid size-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-accent-soft hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                              >
                                <PencilSimple aria-hidden="true" size={14} />
                              </button>
                              <button
                                type="button"
                                aria-label="删除历史记录"
                                title="删除历史记录"
                                onClick={() => void deleteConversation(item.id)}
                                className="grid size-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-cinnabar-soft hover:text-cinnabar-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <Trash aria-hidden="true" size={14} />
                              </button>
                            </span>
                          ) : null;
                        }}
                      />
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-10 text-center">
                <span
                  aria-hidden="true"
                  className="mx-auto mb-3 block h-px w-10 bg-line"
                />
                <p className="text-sm font-medium text-ink-muted">
                  还没有笔记本
                </p>
                <p className="mt-1 text-xs leading-5 text-ink-faint">
                  新建一个，开始你的第一次对话
                </p>
              </div>
            )}
          </div>
        </div>
        {open ? (
          <div
            role="separator"
            aria-label="调整笔记本列表宽度"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_WIDTH_MIN}
            aria-valuemax={SIDEBAR_WIDTH_MAX}
            aria-valuenow={sidebarResize.width}
            tabIndex={0}
            {...sidebarResize.separatorProps}
            className="absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent/20 focus-visible:bg-accent/30 focus-visible:outline-none lg:block"
          />
        ) : null}
      </aside>
    </>
  );
}
