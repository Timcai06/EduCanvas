'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef } from 'react';

/**
 * 旁注导航（灵感来源：React Bits「LineSidebar」，改造为「两支笔」的页边批注身份）。
 * 编号 + 发丝标记线的列表，鼠标邻近时该项向墨紫位移染色、标记线拉长——呼应我们「引用以
 * 旁注形式挂在回答末尾」的排版身份。视觉走令牌（见 globals.css .marginalia-nav__*）。
 *
 * 交互靠单条 rAF 指数平滑：把每项的邻近强度 --effect（0..1）逐帧写入 CSS 变量，位移/染色/
 * 标记线读同一个值、同步不错拍。选中项 --effect 有下限 1。reduced-motion 下不跑 rAF，
 * --effect 仅选中项为 1，退化为静态高亮。卸载时取消 rAF，无泄漏。
 *
 * 通用槽位：meta（右侧小字，如时间）、renderAction（尾部 hover 浮现的动作，如删除），
 * 让学习记录（无删除）与首页笔记本（有删除）复用同一套外观。
 */
export interface MarginaliaItem {
  id: string;
  title: string;
  subtitle?: string;
  /** 右侧小字，如最近活跃时间。 */
  meta?: string;
  badge?: string;
  /** 是否可点击进入；否则渲染为静态项（仍有邻近反馈）。 */
  selectable?: boolean;
}

const PROXIMITY_RADIUS = 88;

export function MarginaliaNav({
  items,
  activeId,
  onSelect,
  ariaLabel,
  renderAction,
  pendingId,
  busy = false,
  animateIn = false,
}: {
  items: readonly MarginaliaItem[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  ariaLabel: string;
  /** 尾部动作（如删除），随 group-hover 浮现，由调用方渲染以免耦合业务。 */
  renderAction?: (item: MarginaliaItem) => React.ReactNode;
  /** 正在切换中的项，短暂降透明度。 */
  pendingId?: string | null;
  /** 全局忙（如切换事务进行中），禁用所有可选项避免重复触发。 */
  busy?: boolean;
  /** 是否在挂载/列表变化时做一次入场 stagger（首页侧栏用；抽屉里由 Sheet 负责入场则关掉）。 */
  animateIn?: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const targets = useRef<number[]>([]);
  const current = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const activeIndexRef = useRef(-1);
  const startRef = useRef<() => void>(() => {});
  const reducedRef = useRef(false);

  // 选中项索引与「是否 reduced」只在 effect 里更新，不在 render 期写 ref。
  useEffect(() => {
    activeIndexRef.current = items.findIndex((item) => item.id === activeId);
    reducedRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const applyStatic = () =>
      itemRefs.current.forEach((el, i) =>
        el?.style.setProperty(
          '--effect',
          activeIndexRef.current === i ? '1' : '0',
        ),
      );

    const frame = (now: number) => {
      const dt = Math.min((now - lastRef.current) / 1000, 0.05);
      lastRef.current = now;
      const k = 1 - Math.exp(-dt / 0.1); // τ=100ms 指数平滑
      let moving = false;
      const els = itemRefs.current;
      for (let i = 0; i < els.length; i += 1) {
        const el = els[i];
        if (!el) continue;
        const target = Math.max(
          targets.current[i] ?? 0,
          activeIndexRef.current === i ? 1 : 0,
        );
        const cur = current.current[i] ?? 0;
        const next = cur + (target - cur) * k;
        const settled = Math.abs(target - next) < 0.0015;
        const value = settled ? target : next;
        current.current[i] = value;
        el.style.setProperty('--effect', value.toFixed(4));
        if (!settled) moving = true;
      }
      rafRef.current = moving ? requestAnimationFrame(frame) : null;
    };

    const start = () => {
      if (reducedRef.current || rafRef.current != null) return;
      lastRef.current = performance.now();
      rafRef.current = requestAnimationFrame(frame);
    };
    startRef.current = start;

    if (reducedRef.current) applyStatic();
    else start();

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [items, activeId]);

  // 入场 stagger：仅 animateIn 时，行从左侧微位移淡入；reduced-motion 下 matchMedia 不匹配即跳过。
  useGSAP(
    () => {
      if (!animateIn) return;
      const rows = itemRefs.current.filter(Boolean);
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
      // 清理放在外层 useGSAP 回调（不能放进 media.add 内部，否则 revert→cleanup→revert 无限递归爆栈）
      return () => media.revert();
    },
    { scope: listRef, dependencies: [items.length, animateIn] },
  );

  const onPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    if (reducedRef.current) return;
    const list = listRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const pointerY = event.clientY - rect.top;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const center = el.offsetTop + el.offsetHeight / 2;
      const distance = Math.abs(pointerY - center);
      const p = Math.max(0, 1 - distance / PROXIMITY_RADIUS);
      targets.current[i] = p * p * (3 - 2 * p); // smoothstep
    });
    startRef.current();
  };

  const onPointerLeave = () => {
    if (reducedRef.current) return;
    targets.current = targets.current.map(() => 0);
    startRef.current();
  };

  return (
    <nav aria-label={ariaLabel}>
      <ul
        ref={listRef}
        className="flex flex-col gap-0.5"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {items.map((item, index) => {
          const rowInner = (
            <>
              <span className="marginalia-nav__index shrink-0 self-start pt-0.5 font-mono text-[11px] tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="marginalia-nav__title block truncate text-sm font-medium">
                  {item.title}
                </span>
                {item.subtitle ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                    <span className="truncate">{item.subtitle}</span>
                    {item.badge ? (
                      <span className="shrink-0 text-cinnabar">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              {item.meta ? (
                <span className="shrink-0 self-start pt-0.5 text-[11px] text-ink-muted">
                  {item.meta}
                </span>
              ) : null}
            </>
          );
          const rowClass =
            'flex w-full items-start gap-2.5 rounded-xl py-2 pl-7 pr-2.5 text-left transition-colors';

          return (
            <li
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={`group relative ${pendingId === item.id ? 'opacity-60' : ''}`}
            >
              <span
                aria-hidden="true"
                className="marginalia-nav__marker pointer-events-none absolute left-0 top-1/2 h-px w-5 -translate-y-1/2"
              />
              <div className="flex items-stretch">
                {item.selectable && onSelect ? (
                  <button
                    type="button"
                    data-session-id={item.id}
                    aria-current={item.id === activeId ? 'page' : undefined}
                    disabled={busy}
                    onClick={() => onSelect(item.id)}
                    className={`${rowClass} min-w-0 flex-1 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                  >
                    {rowInner}
                  </button>
                ) : (
                  <div
                    data-session-id={item.id}
                    aria-current={item.id === activeId ? 'page' : undefined}
                    className={`${rowClass} min-w-0 flex-1`}
                  >
                    {rowInner}
                  </div>
                )}
                {renderAction ? (
                  <div className="flex shrink-0 items-center">
                    {renderAction(item)}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
