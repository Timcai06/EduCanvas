'use client';

import { GraduationCap, List, SquaresFour } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { PillNav, type PillNavItem } from '@/components/PillNav';
import { ProductMark } from '@/components/ProductMark';
import { UserMenu } from '@/features/auth/user-menu';

/**
 * 通用笔记本顶部导航。只负责入口与可访问状态，不读取会话或产物数据；
 * 侧栏业务动作由工作区组合根注入；新建只保留在侧栏，账号、外观与通信方式统一
 * 收进头像入口，顶栏不再维护重复的齿轮按钮。
 */
export function GeneralWorkspaceHeader({
  notebookTitle,
  conversationId,
  sidebarOpen,
  studioOpen,
  onToggleSidebar,
  onOpenStudio,
}: {
  notebookTitle: string | null;
  conversationId: string;
  sidebarOpen: boolean;
  studioOpen: boolean;
  onToggleSidebar: () => void;
  onOpenStudio: () => void;
}) {
  const items = useMemo<readonly PillNavItem[]>(
    () => [
      {
        id: 'notebooks',
        label: '笔记本',
        ariaLabel: sidebarOpen ? '关闭笔记本列表' : '打开笔记本列表',
        icon: <List size={17} weight="bold" />,
        active: sidebarOpen,
        ariaExpanded: sidebarOpen,
        ariaControls: 'conversation-sidebar',
        onSelect: onToggleSidebar,
      },
      {
        id: 'resources',
        label: '资源控制台',
        ariaLabel: studioOpen ? '资源控制台已打开' : '打开资源控制台',
        icon: <SquaresFour size={17} weight="duotone" />,
        active: studioOpen,
        onSelect: onOpenStudio,
      },
      {
        id: 'learning-plan',
        label: '学习计划',
        href: '/learn',
        icon: <GraduationCap size={17} weight="duotone" />,
      },
    ],
    [onOpenStudio, onToggleSidebar, sidebarOpen, studioOpen],
  );

  return (
    <header className="z-20 flex h-16 shrink-0 items-center gap-3 px-3 sm:px-5">
      <ProductMark />
      <span
        className="hidden h-4 w-px bg-line/80 sm:block"
        aria-hidden="true"
      />
      <span className="hidden max-w-44 truncate text-xs font-medium text-ink-muted md:block xl:max-w-64">
        {notebookTitle ?? '未命名笔记本'}
      </span>
      <span className="flex-1" />
      <PillNav items={items} />
      <UserMenu conversationId={conversationId} notebookTitle={notebookTitle} />
    </header>
  );
}
