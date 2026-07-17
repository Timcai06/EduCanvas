'use client';

import { switchConversationAction } from '@/app/actions';
import { useGSAP } from '@gsap/react';
import { ChatCircle, Plus } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';

gsap.registerPlugin(useGSAP);

interface ConversationListItem {
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
 * Gemini 式侧栏:历史对话 + 新对话。桌面端常驻(lg+),窄屏由头部入口承担。
 * 只消费公开投影;切换经 Server Action 校验归属后写游标,浏览器不持有会话密钥。
 */
export function ConversationSidebar({
  activeConversationId,
  onNewChat,
}: {
  activeConversationId: string | null;
  onNewChat: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<readonly ConversationListItem[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/chat/conversations')
      .then(async (response) =>
        response.ok ? ((await response.json()) as { conversations: ConversationListItem[] }) : { conversations: [] },
      )
      .then((data) => {
        if (active) setItems(data.conversations);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeConversationId]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '[data-sidebar-item]',
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
    { scope: rootRef, dependencies: [items.length > 0], revertOnUpdate: true },
  );

  return (
    <nav
      ref={rootRef}
      aria-label="历史对话"
      className="hidden w-60 shrink-0 flex-col border-r border-line/60 bg-canvas/60 lg:flex"
    >
      <div className="px-3 pt-3 pb-1.5">
        <button
          type="button"
          onClick={onNewChat}
          className="flex min-h-10 w-full items-center gap-2.5 rounded-full bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus aria-hidden="true" size={16} weight="bold" />
          新对话
        </button>
      </div>
      <p className="px-5 pt-3 pb-1 text-xs font-medium text-ink-faint">近期</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {items.map((item) => {
          const isActive = item.id === activeConversationId;
          return (
            <li key={item.id} data-sidebar-item>
              <button
                type="button"
                aria-current={isActive ? 'true' : undefined}
                disabled={pendingId !== null}
                onClick={() => {
                  if (isActive) return;
                  setPendingId(item.id);
                  void switchConversationAction(item.id);
                }}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink-muted hover:bg-surface hover:text-ink'
                } ${pendingId === item.id ? 'opacity-60' : ''}`}
              >
                <ChatCircle
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 text-ink-faint"
                />
                <span className="min-w-0 flex-1 truncate">
                  {item.title ?? '未命名对话'}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {formatWhen(item.lastActivityAt)}
                </span>
              </button>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="px-3 py-2 text-xs text-ink-faint">还没有历史对话</li>
        ) : null}
      </ul>
    </nav>
  );
}
