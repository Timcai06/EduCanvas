'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import './PillNav.css';

export interface PillNavItem {
  id: string;
  label: string;
  ariaLabel?: string;
  href?: string;
  icon?: ReactNode;
  active?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
  dataStudioTrigger?: boolean;
  onSelect?: () => void;
}

export interface PillNavProps {
  items: readonly PillNavItem[];
  className?: string;
  initialLoadAnimation?: boolean;
}

/**
 * 工作区的胶囊导航动效层。它只负责导航元素和 GSAP 生命周期；
 * 路由、Notebook 与 Studio 状态均由调用方注入，组件自身不持有业务状态。
 */
export function PillNav({
  items,
  className = '',
  initialLoadAnimation = true,
}: PillNavProps) {
  const rootRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const circleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const timelinesRef = useRef<(gsap.core.Timeline | null)[]>([]);
  const activeTweensRef = useRef<(gsap.core.Tween | null)[]>([]);
  const reducedMotionRef = useRef(false);
  const itemSignature = useMemo(
    () => items.map((item) => item.id).join('|'),
    [items],
  );

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const media = gsap.matchMedia();
      const resizeObserver = new ResizeObserver(() => layoutItems());

      function layoutItems() {
        const measurements = itemRefs.current.map((pill) =>
          pill ? pill.getBoundingClientRect() : null,
        );
        measurements.forEach((rect, index) => {
          const circle = circleRefs.current[index];
          const pill = itemRefs.current[index];
          if (!rect || !circle || !pill) return;
          const { width, height } = rect;
          const radius = ((width * width) / 4 + height * height) / (2 * height);
          const diameter = Math.ceil(radius * 2) + 2;
          const delta =
            Math.ceil(
              radius -
                Math.sqrt(Math.max(0, radius * radius - (width * width) / 4)),
            ) + 1;
          const originY = diameter - delta;
          circle.style.width = `${diameter}px`;
          circle.style.height = `${diameter}px`;
          circle.style.bottom = `-${delta}px`;
          gsap.set(circle, {
            xPercent: -50,
            scale: 0,
            transformOrigin: `50% ${originY}px`,
          });
          const baseLabel = pill.querySelector<HTMLElement>(
            '.educanvas-pill-nav__label-base',
          );
          const hoverLabel = pill.querySelector<HTMLElement>(
            '.educanvas-pill-nav__label-hover',
          );
          gsap.set(baseLabel, { yPercent: 0, autoAlpha: 1 });
          gsap.set(hoverLabel, { yPercent: 140, autoAlpha: 0 });
          timelinesRef.current[index]?.kill();
          timelinesRef.current[index] = gsap
            .timeline({ paused: true })
            .to(circle, { scale: 1.2, duration: 0.55, ease: 'power3.out' }, 0)
            .to(
              baseLabel,
              {
                yPercent: -140,
                autoAlpha: 0,
                duration: 0.42,
                ease: 'power3.out',
              },
              0,
            )
            .to(
              hoverLabel,
              {
                yPercent: 0,
                autoAlpha: 1,
                duration: 0.42,
                ease: 'power3.out',
              },
              0,
            );
        });
      }

      itemRefs.current.forEach((item) => {
        if (item) resizeObserver.observe(item);
      });
      layoutItems();
      void document.fonts?.ready.then(layoutItems);

      media.add('(prefers-reduced-motion: reduce)', () => {
        reducedMotionRef.current = true;
        gsap.set(root, { autoAlpha: 1 });
        gsap.set(itemRefs.current, { autoAlpha: 1, x: 0, y: 0 });
      });
      media.add('(prefers-reduced-motion: no-preference)', () => {
        reducedMotionRef.current = false;
        if (!initialLoadAnimation) return;
        gsap.fromTo(
          itemRefs.current,
          { autoAlpha: 0, x: -10, y: -5 },
          {
            autoAlpha: 1,
            x: 0,
            y: 0,
            duration: 0.42,
            stagger: 0.055,
            ease: 'power3.out',
          },
        );
      });

      return () => {
        resizeObserver.disconnect();
        media.revert();
        timelinesRef.current.forEach((timeline) => timeline?.kill());
        activeTweensRef.current.forEach((tween) => tween?.kill());
      };
    },
    {
      scope: rootRef,
      dependencies: [initialLoadAnimation, itemSignature],
      revertOnUpdate: true,
    },
  );

  const moveTimeline = useCallback((index: number, direction: 'in' | 'out') => {
    if (reducedMotionRef.current) return;
    const timeline = timelinesRef.current[index];
    if (!timeline) return;
    activeTweensRef.current[index]?.kill();
    activeTweensRef.current[index] = timeline.tweenTo(
      direction === 'in' ? timeline.duration() : 0,
      {
        duration: direction === 'in' ? 0.28 : 0.2,
        ease: 'power3.out',
        overwrite: 'auto',
      },
    );
  }, []);

  return (
    <nav
      ref={rootRef}
      aria-label="工作区主导航"
      className={`educanvas-pill-nav ${className}`}
    >
      <div className="educanvas-pill-nav__items">
        <ul className="educanvas-pill-nav__list">
          {items.map((item, index) => {
            const content = (
              <>
                <span
                  ref={(element) => {
                    circleRefs.current[index] = element;
                  }}
                  className="educanvas-pill-nav__circle"
                  aria-hidden="true"
                />
                <span className="educanvas-pill-nav__label-stack">
                  <span className="educanvas-pill-nav__label-base">
                    {item.icon}
                    <span className="educanvas-pill-nav__text">
                      {item.label}
                    </span>
                  </span>
                  <span
                    className="educanvas-pill-nav__label-hover"
                    aria-hidden="true"
                  >
                    {item.icon}
                    <span className="educanvas-pill-nav__text">
                      {item.label}
                    </span>
                  </span>
                </span>
              </>
            );
            const shared = {
              'aria-label': item.ariaLabel ?? item.label,
              'aria-current': item.active ? ('page' as const) : undefined,
              'aria-expanded': item.ariaExpanded,
              'aria-controls': item.ariaControls,
              'data-studio-trigger': item.dataStudioTrigger ? true : undefined,
              className: `educanvas-pill-nav__pill${item.active ? ' is-active' : ''}`,
              onMouseEnter: () => moveTimeline(index, 'in'),
              onMouseLeave: () => moveTimeline(index, 'out'),
            };
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    {...shared}
                    href={item.href}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    {...shared}
                    type="button"
                    onClick={item.onSelect}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
