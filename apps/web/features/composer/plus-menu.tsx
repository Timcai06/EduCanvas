'use client';

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
}

/** 菜单固定两组八项，与 docs/01-product/student-ui-spec.md 的输入栏规格一一对应。 */
const menuGroups: readonly { title: string; items: readonly PlusMenuItem[] }[] =
  [
    {
      title: '添加学习材料',
      items: [
        { id: 'upload_file', label: '上传文件', hint: 'PDF、文档' },
        { id: 'upload_image', label: '上传图片', hint: '拍题、截图' },
        { id: 'pick_course_material', label: '选择课程资料', hint: '本课教材' },
        { id: 'add_link', label: '添加链接', hint: '网页资料' },
      ],
    },
    {
      title: '请老师创建',
      items: [
        { id: 'create_demo', label: '创建互动演示', hint: '动手试概念' },
        { id: 'create_slides', label: '生成 Slide', hint: '讲解页' },
        { id: 'create_quiz', label: '生成测验', hint: '老师批改' },
        { id: 'more_tools', label: '更多教学工具', hint: '陆续开放' },
      ],
    },
  ];

const allItems = menuGroups.flatMap((group) => group.items);

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
  const [activeIndex, setActiveIndex] = useState(0);
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
      setActiveIndex(
        (current) => (current + delta + allItems.length) % allItems.length,
      );
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
          setActiveIndex(0);
          setOpen((value) => !value);
        }}
        className="grid size-10 shrink-0 place-items-center rounded-full text-xl text-ink-muted transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden="true">＋</span>
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
                    tabIndex={index === activeIndex ? 0 : -1}
                    onClick={() => {
                      close(true);
                      onAction(item.id);
                    }}
                    className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
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
