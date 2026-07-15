'use client';

import { Plus } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

export type PlusMenuActionId =
  | 'upload_file'
  | 'upload_image'
  | 'pick_course_material'
  | 'add_link'
  | 'create_demo'
  | 'create_slides'
  | 'create_quiz'
  | 'more_tools';

interface PlusMenuItem {
  id: PlusMenuActionId;
  label: string;
  hint: string;
  available: boolean;
}

/**
 * 菜单保留目标能力信息架构，但只有已经存在的本课预置互动可执行；其余项明确
 * disabled，也不会进入 roving focus，避免把路线图伪装成当前产品能力。
 */
const menuGroups: readonly { title: string; items: readonly PlusMenuItem[] }[] =
  [
    {
      title: '添加学习材料',
      items: [
        {
          id: 'upload_file',
          label: '上传文件',
          hint: '即将开放',
          available: false,
        },
        {
          id: 'upload_image',
          label: '上传图片',
          hint: '即将开放',
          available: false,
        },
        {
          id: 'pick_course_material',
          label: '选择课程资料',
          hint: '即将开放',
          available: false,
        },
        {
          id: 'add_link',
          label: '添加链接',
          hint: '即将开放',
          available: false,
        },
      ],
    },
    {
      title: '请老师创建',
      items: [
        {
          id: 'create_demo',
          label: '打开本课互动演示',
          hint: '课程预置',
          available: true,
        },
        {
          id: 'create_slides',
          label: '生成 Slide',
          hint: '即将开放',
          available: false,
        },
        {
          id: 'create_quiz',
          label: '生成测验',
          hint: '即将开放',
          available: false,
        },
        {
          id: 'more_tools',
          label: '更多教学工具',
          hint: '即将开放',
          available: false,
        },
      ],
    },
  ];

const allItems = menuGroups.flatMap((group) => group.items);
const enabledIndexes = allItems.flatMap((item, index) =>
  item.available ? [index] : [],
);
const firstEnabledIndex = enabledIndexes[0] ?? 0;

/**
 * 「+」菜单自管开合与键盘漫游（↑↓/Enter/Esc），动作语义交给上层：
 * 「添加材料」进入上下文标签，「请老师创建」必须先产生参数确认卡，绝不静默生成。
 */
export function PlusMenu({
  onAction,
}: {
  onAction: (action: PlusMenuActionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(firstEnabledIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        const enabledPosition = enabledIndexes.indexOf(current);
        const nextPosition =
          (enabledPosition + delta + enabledIndexes.length) %
          enabledIndexes.length;
        return enabledIndexes[nextPosition] ?? firstEnabledIndex;
      });
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="添加材料或请老师创建"
        onClick={() => {
          setActiveIndex(firstEnabledIndex);
          setOpen((value) => !value);
        }}
        className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus aria-hidden="true" size={22} weight="regular" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="添加材料或请老师创建"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-12 left-0 z-50 w-64 rounded-2xl border border-line bg-canvas p-2 shadow-[var(--shadow-sheet)]"
        >
          {menuGroups.map((group) => (
            <div key={group.title} role="group" aria-label={group.title}>
              <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-faint">
                {group.title}
              </p>
              {group.items.map((item) => {
                const index = allItems.indexOf(item);
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={!item.available}
                    aria-disabled={!item.available}
                    tabIndex={item.available && index === activeIndex ? 0 : -1}
                    onClick={() => {
                      close(true);
                      onAction(item.id);
                    }}
                    className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink transition-colors enabled:hover:bg-surface enabled:focus-visible:bg-surface enabled:focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-faint disabled:opacity-65"
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-ink-faint">{item.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
