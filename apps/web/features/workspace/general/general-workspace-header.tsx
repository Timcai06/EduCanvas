'use client';

import {
  CaretDown,
  GraduationCap,
  List,
  NotePencil,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { UserMenu } from '@/features/auth/user-menu';
import { LogoMark } from '../shared/logo-mark';

/**
 * 通用笔记本顶部导航。只负责入口与可访问状态，不读取会话或产物数据；
 * 新建、侧栏和 Studio 的业务动作由工作区组合根注入；账号、外观与通信方式统一
 * 收进头像入口，顶栏不再维护重复的齿轮按钮。
 */
export function GeneralWorkspaceHeader({
  notebookTitle,
  conversationId,
  sidebarOpen,
  studioOpen,
  onToggleSidebar,
  onNewNotebook,
  onOpenStudio,
}: {
  notebookTitle: string | null;
  conversationId: string;
  sidebarOpen: boolean;
  studioOpen: boolean;
  onToggleSidebar: () => void;
  onNewNotebook: () => void;
  onOpenStudio: () => void;
}) {
  return (
    <header className="z-20 flex h-16 shrink-0 items-center gap-1.5 px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? '关闭笔记本列表' : '打开笔记本列表'}
        aria-expanded={sidebarOpen}
        aria-controls="conversation-sidebar"
        title={sidebarOpen ? '关闭笔记本列表' : '打开笔记本列表'}
        className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <List size={19} weight="bold" />
      </button>
      <button
        type="button"
        onClick={onNewNotebook}
        aria-label="新建笔记本"
        title="新建笔记本"
        className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <NotePencil size={19} />
      </button>
      <span className="ml-1 inline-flex items-center gap-2.5 font-display text-base font-semibold">
        <LogoMark size={20} />
        <span className="hidden sm:inline">EduCanvas</span>
      </span>
      <span
        aria-hidden="true"
        className="hidden h-5 w-px bg-line/80 sm:block"
      />
      <span className="max-w-40 truncate text-sm font-medium text-ink-muted sm:max-w-64">
        {notebookTitle ?? '未命名笔记本'}
      </span>
      <span className="flex-1" />
      <Link
        href="/learn"
        className="mr-1 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <GraduationCap aria-hidden="true" size={17} className="text-accent" />
        <span className="hidden sm:inline">学习计划</span>
      </Link>
      <UserMenu conversationId={conversationId} notebookTitle={notebookTitle} />
      <button
        type="button"
        aria-expanded={studioOpen}
        aria-controls="notebook-studio-layer"
        data-studio-trigger
        title="展开当前笔记本的输入与输出"
        onClick={onOpenStudio}
        className="group inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line/70 px-3.5 py-2 text-sm text-ink-muted transition-colors hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Studio
        <CaretDown
          aria-hidden="true"
          size={14}
          weight="bold"
          className={`transition-transform duration-300 ${
            studioOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
    </header>
  );
}
