'use client';

import { useGSAP } from '@gsap/react';
import {
  BookOpen,
  FileArrowUp,
  ImageSquare,
  Plus,
  PresentationChart,
  Cards,
  Slideshow,
  TreeStructure,
  Headphones,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

gsap.registerPlugin(useGSAP);

export type PlusMenuActionId =
  | 'upload_file'
  | 'upload_image'
  | 'create_mind_map'
  | 'create_flashcards'
  | 'create_audio_overview'
  | 'pick_course_material'
  | 'add_link'
  | 'create_demo'
  | 'create_slides'
  | 'create_quiz'
  | 'more_tools';

interface PlusMenuItem {
  id: PlusMenuActionId;
  icon: Icon;
  label: string;
  available: boolean;
}

/**
 * Gemini 式紧凑菜单:单列图标行,只渲染真实接通的能力。
 * 未接入的动作不再以 disabled 行占位——不展示就是最诚实的"未开放"。
 */
const menuItems: readonly PlusMenuItem[] = [
  { id: 'upload_file', icon: FileArrowUp, label: '上传文件', available: true },
  {
    id: 'upload_image',
    icon: ImageSquare,
    label: '上传图片',
    available: true,
  },
  {
    id: 'pick_course_material',
    icon: BookOpen,
    label: '选择课程资料',
    available: false,
  },
  {
    id: 'create_mind_map',
    icon: TreeStructure,
    label: '生成思维导图',
    available: true,
  },
  {
    id: 'create_slides',
    icon: Slideshow,
    label: '生成 Slides',
    available: true,
  },
  {
    id: 'create_flashcards',
    icon: Cards,
    label: '生成闪卡',
    available: true,
  },
  {
    id: 'create_audio_overview',
    icon: Headphones,
    label: '生成音频概览',
    available: true,
  },
  {
    id: 'create_demo',
    icon: PresentationChart,
    label: '打开互动演示',
    available: true,
  },
];

/**
 * 「+」菜单自管开合与键盘漫游（↑↓/Enter/Esc），动作语义交给上层：
 * 通用笔记本中的上传会沉淀为来源；「请老师创建」必须先产生参数确认卡，绝不静默生成。
 */
export function PlusMenu({
  onAction,
  availableActions,
}: {
  onAction: (action: PlusMenuActionId) => void;
  availableActions?: readonly PlusMenuActionId[];
}) {
  const items = useMemo(
    () =>
      menuItems.filter(
        (item) =>
          item.available &&
          (availableActions === undefined ||
            availableActions.includes(item.id)),
      ),
    [availableActions],
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
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
      const rows = menu.querySelectorAll('[role="menuitem"]');
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const timeline = gsap.timeline();
        timeline.fromTo(
          menu,
          { opacity: 0, y: 8, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'power3.out' },
        );
        timeline.fromTo(
          rows,
          { opacity: 0, y: 4 },
          {
            opacity: 1,
            y: 0,
            duration: 0.18,
            stagger: 0.025,
            ease: 'power1.out',
          },
          0.04,
        );
        return () => timeline.kill();
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set([menu, ...rows], { opacity: 1, y: 0, scale: 1 });
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
      setActiveIndex(
        (current) => (current + delta + items.length) % items.length,
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
        aria-label="添加上下文或创建内容"
        onClick={() => {
          setActiveIndex(0);
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
          className="absolute bottom-12 left-0 z-50 w-56 origin-bottom-left rounded-2xl border border-line/80 bg-surface/98 py-1.5 shadow-[var(--shadow-sheet)] backdrop-blur-xl"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                close(true);
                onAction(item.id);
              }}
              className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-strong focus-visible:bg-surface-strong focus-visible:outline-none"
            >
              <item.icon
                aria-hidden="true"
                size={19}
                className="shrink-0 text-ink-muted"
              />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
