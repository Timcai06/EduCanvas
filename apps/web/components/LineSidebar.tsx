'use client';

import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import './LineSidebar.css';

type Falloff = 'linear' | 'smooth' | 'sharp';

export interface LineSidebarProps {
  items: readonly string[];
  itemIds?: readonly string[];
  accentColor?: string;
  textColor?: string;
  markerColor?: string;
  showIndex?: boolean;
  showMarker?: boolean;
  proximityRadius?: number;
  maxShift?: number;
  falloff?: Falloff;
  markerLength?: number;
  markerGap?: number;
  tickScale?: number;
  scaleTick?: boolean;
  itemGap?: number;
  fontSize?: number;
  smoothing?: number;
  defaultActive?: number | null;
  activeIndex?: number | null;
  disabled?: boolean;
  ariaLabel?: string;
  onItemClick?: (index: number, label: string) => void;
  renderLabel?: (index: number, label: string) => ReactNode;
  renderAction?: (index: number, label: string) => ReactNode;
  actionWidth?: number;
  className?: string;
}

const FALLOFF_CURVES: Record<Falloff, (proximity: number) => number> = {
  linear: (proximity) => proximity,
  smooth: (proximity) => proximity * proximity * (3 - 2 * proximity),
  sharp: (proximity) => proximity * proximity * proximity,
};

/**
 * React Bits LineSidebar 的 EduCanvas 适配层。
 *
 * 保留官方单 rAF 邻近插值；增加受控当前项、键盘按钮、尾部动作和滚动容器坐标
 * 修正。组件只表达列表交互，不持有 Notebook ID 或删除、切换等业务权限。
 */
export default function LineSidebar({
  items,
  itemIds,
  accentColor = '#a855f7',
  textColor = '#c4c4c4',
  markerColor = '#6c6c6c',
  showIndex = true,
  showMarker = true,
  proximityRadius = 100,
  maxShift = 30,
  falloff = 'smooth',
  markerLength = 60,
  markerGap = 0,
  tickScale = 0.5,
  scaleTick = true,
  itemGap = 20,
  fontSize = 1.1,
  smoothing = 100,
  defaultActive = null,
  activeIndex,
  disabled = false,
  ariaLabel = 'Navigation',
  onItemClick,
  renderLabel,
  renderAction,
  actionWidth = 0,
  className = '',
}: LineSidebarProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const targetsRef = useRef<number[]>([]);
  const currentRef = useRef<number[]>([]);
  const rowCentersRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const activeRef = useRef<number | null>(activeIndex ?? defaultActive);
  const smoothingRef = useRef(smoothing);
  const reducedMotionRef = useRef(false);
  const [internalActiveIndex, setInternalActiveIndex] = useState<number | null>(
    defaultActive,
  );
  const resolvedActiveIndex =
    activeIndex === undefined ? internalActiveIndex : activeIndex;

  const measureRows = useCallback(() => {
    rowCentersRef.current = itemRefs.current.map((element) =>
      element ? element.offsetTop + element.offsetHeight / 2 : 0,
    );
  }, []);

  const runFrame = useCallback(function animateSidebar(now: number) {
    const deltaTime = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const timeConstant = Math.max(smoothingRef.current, 1) / 1000;
    const easing = 1 - Math.exp(-deltaTime / timeConstant);
    let moving = false;

    for (let index = 0; index < itemRefs.current.length; index += 1) {
      const element = itemRefs.current[index];
      if (!element) continue;
      const target = Math.max(
        targetsRef.current[index] ?? 0,
        activeRef.current === index ? 1 : 0,
      );
      const current = currentRef.current[index] ?? 0;
      const next = current + (target - current) * easing;
      const settled = Math.abs(target - next) < 0.0015;
      const value = settled ? target : next;
      currentRef.current[index] = value;
      element.style.setProperty('--effect', value.toFixed(4));
      if (!settled) moving = true;
    }

    rafRef.current = moving ? requestAnimationFrame(animateSidebar) : null;
  }, []);

  const startLoop = useCallback(() => {
    if (reducedMotionRef.current || rafRef.current !== null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  useEffect(() => {
    activeRef.current = resolvedActiveIndex;
    smoothingRef.current = smoothing;
    reducedMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    itemRefs.current.length = items.length;
    targetsRef.current.length = items.length;
    currentRef.current.length = items.length;
    measureRows();

    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(measureRows);
    observer.observe(list);

    if (reducedMotionRef.current) {
      itemRefs.current.forEach((element, index) => {
        element?.style.setProperty(
          '--effect',
          resolvedActiveIndex === index ? '1' : '0',
        );
      });
      return () => observer.disconnect();
    }
    startLoop();
    return () => observer.disconnect();
  }, [items.length, measureRows, resolvedActiveIndex, smoothing, startLoop]);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLUListElement>) => {
      if (reducedMotionRef.current) return;
      const ease = FALLOFF_CURVES[falloff] ?? FALLOFF_CURVES.linear;
      const listTop = event.currentTarget.getBoundingClientRect().top;
      const pointerY = event.clientY - listTop;
      itemRefs.current.forEach((element, index) => {
        if (!element) return;
        const distance = Math.abs(
          pointerY - (rowCentersRef.current[index] ?? 0),
        );
        targetsRef.current[index] = ease(
          Math.max(0, 1 - distance / proximityRadius),
        );
      });
      startLoop();
    },
    [falloff, proximityRadius, startLoop],
  );

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );

  return (
    <nav
      aria-label={ariaLabel}
      className={`line-sidebar${showMarker ? ' line-sidebar--markers' : ''}${scaleTick ? ' line-sidebar--scale-tick' : ''}${className ? ` ${className}` : ''}`}
      style={
        {
          '--accent-color': accentColor,
          '--text-color': textColor,
          '--marker-color': markerColor,
          '--marker-length': `${markerLength}px`,
          '--marker-gap': `${markerGap}px`,
          '--tick-scale': tickScale,
          '--max-shift': `${maxShift}px`,
          '--item-gap': `${itemGap}px`,
          '--font-size': `${fontSize}rem`,
          '--action-width': `${renderAction ? actionWidth : 0}px`,
        } as CSSProperties
      }
    >
      <ul
        ref={listRef}
        className="line-sidebar__list"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {items.map((label, index) => (
          <li
            key={itemIds?.[index] ?? `${label}-${index}`}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className="line-sidebar__item"
          >
            {showMarker ? (
              <span className="line-sidebar__marker" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              data-session-id={itemIds?.[index]}
              disabled={disabled}
              aria-current={resolvedActiveIndex === index ? 'page' : undefined}
              className="line-sidebar__button"
              onClick={() => {
                if (activeIndex === undefined) {
                  setInternalActiveIndex(index);
                }
                onItemClick?.(index, label);
              }}
            >
              <span className="line-sidebar__label">
                {showIndex ? (
                  <span className="line-sidebar__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                ) : null}
                <span className="line-sidebar__text">
                  {renderLabel?.(index, label) ?? label}
                </span>
              </span>
            </button>
            {renderAction ? (
              <span className="line-sidebar__action">
                {renderAction(index, label)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
