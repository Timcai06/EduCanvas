'use client';

import { Notepad, Question, Lightning } from '@phosphor-icons/react';

/**
 * semanticRole 的可视化徽标（从渲染器主体拆出以守住文件治理基线）：
 * 图标 + 语义色 token；未标注角色不渲染任何内容。
 */
const SEMANTIC_ROLE_ICONS = {
  question: { Icon: Question, className: 'text-warn' },
  annotation: { Icon: Notepad, className: 'text-accent' },
  action: { Icon: Lightning, className: 'text-good' },
} as const;

export function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const entry = SEMANTIC_ROLE_ICONS[role as keyof typeof SEMANTIC_ROLE_ICONS];
  if (!entry) return null;
  const Icon = entry.Icon;
  return (
    <Icon
      aria-hidden="true"
      size={13}
      className={`shrink-0 ${entry.className}`}
    />
  );
}
