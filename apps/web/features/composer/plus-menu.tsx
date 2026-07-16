'use client';

import { useGSAP } from '@gsap/react';
import { Plus } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

gsap.registerPlugin(useGSAP);

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
 * 菜单只开放真实纵切：图片/PDF上传和本课受控互动。未接入能力保持disabled。
 */
const menuGroups: readonly { title: string; items: readonly PlusMenuItem[] }[] =
  [
    {
      title: '添加上下文',
      items: [
        {
          id: 'upload_file',
          label: '上传文件',
          hint: 'PDF · 10MB',
          available: true,
        },
        {
          id: 'upload_image',
          label: '上传图片',
          hint: 'PNG/JPEG/WebP',
          available: true,
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
      title: '创建与工具',
      items: [
        {
          id: 'create_demo',
          label: '打开互动演示',
          hint: '受控模板',
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
          label: '更多工具',
          hint: '即将开放',
          available: false,
        },
      ],
    },
  ];

/**
 * 「+」菜单自管开合与键盘漫游（↑↓/Enter/Esc），动作语义交给上层：
 * 「添加材料」进入上下文标签，「请老师创建」必须先产生参数确认卡，绝不静默生成。
 */
export function PlusMenu({
  onAction,
  availableActions,
}: {
  onAction: (action: PlusMenuActionId) => void;
  availableActions?: readonly PlusMenuActionId[];
}) {
  const renderedGroups = useMemo(
    () =>
      menuGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          available:
            item.available &&
            (availableActions === undefined ||
              availableActions.includes(item.id)),
        })),
      })),
    [availableActions],
  );
  const allItems = useMemo(
    () => renderedGroups.flatMap((group) => group.items),
    [renderedGroups],
  );
  const enabledIndexes = useMemo(
    () => allItems.flatMap((item, index) => (item.available ? [index] : [])),
    [allItems],
  );
  const firstEnabledIndex = enabledIndexes[0] ?? 0;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(firstEnabledIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"][tabindex="0"]')
      ?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useGSAP(
    () => {
      if (!open) return;
      const menu = rootRef.current?.querySelector('[data-plus-menu]');
      if (!menu) return;
      const items = menu.querySelectorAll('[role="menuitem"]');
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const timeline = gsap.timeline();
        timeline.fromTo(
          menu,
          { opacity: 0, y: 6, scale: 0.985 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.2,
            ease: 'power2.out',
          },
        );
        timeline.fromTo(
          items,
          { opacity: 0, y: 3 },
          {
            opacity: 1,
            y: 0,
            duration: 0.16,
            stagger: 0.018,
            ease: 'power1.out',
          },
          0.035,
        );
        return () => timeline.kill();
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set([menu, ...items], { opacity: 1, y: 0, scale: 1 });
      });
      return () => media.revert();
    },
    { dependencies: [open], scope: rootRef, revertOnUpdate: true },
  );

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
        aria-label="添加上下文或创建内容"
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
          data-plus-menu
          id={menuId}
          role="menu"
          aria-label="添加上下文或创建内容"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-12 left-0 z-50 max-h-[min(70dvh,22rem)] w-64 origin-bottom-left overflow-y-auto rounded-2xl border border-line/90 bg-canvas/95 p-2 shadow-[var(--shadow-sheet)] backdrop-blur-xl sm:grid sm:w-[32rem] sm:grid-cols-2 sm:gap-2 sm:overflow-visible"
        >
          {renderedGroups.map((group) => (
            <div key={group.title} role="group" aria-label={group.title}>
              <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-faint">
                {group.title}
              </p>
              {group.items.map((item) => {
                const index = allItems.indexOf(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    autoFocus={index === firstEnabledIndex}
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
