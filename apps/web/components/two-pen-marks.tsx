'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP, DrawSVGPlugin);

/**
 * 「两支笔」的批改笔迹。朱砂只在批改语义下出现——这两个组件是它的主要出口。
 * 对错靠字形（对勾 / 圈点）与文案区分，颜色只是笔的身份，不独立承载语义，
 * 因此色弱与无色环境下含义不丢失。
 */

/** 老师批改的笔迹：答对是一笔对勾，值得再想是一个圈点。出现时按书写笔顺画出。 */
export function GradeMark({
  correct,
  size = 18,
}: {
  correct: boolean;
  size?: number;
}) {
  const rootRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useGSAP(
    () => {
      const path = pathRef.current;
      if (!path) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          path,
          { drawSVG: '0%' },
          { drawSVG: '100%', duration: 0.4, ease: 'power2.inOut' },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [correct], revertOnUpdate: true },
  );

  return (
    <svg
      ref={rootRef}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className="shrink-0"
    >
      {correct ? (
        <path
          ref={pathRef}
          d="M3.5 10.5l4.6 4.8L16.8 4.6"
          stroke="var(--color-cinnabar)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          ref={pathRef}
          d="M10 3.4a6.6 6.6 0 1 1-6.4 8.2"
          stroke="var(--color-cinnabar)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * 朱砂印章：掌握时刻的落款。方框微倾、章面一个字，像盖在作业本角上的章。
 * 出现动效是「盖下去」——轻微放大落定；reduced-motion 直接静态出现。
 */
export function SealStamp({
  char = '掌',
  label,
}: {
  /** 章面单字。多于一个字会破坏印章比例，调用方自行保证。 */
  char?: string;
  label: string;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          root,
          { autoAlpha: 0, scale: 1.5, rotate: -10 },
          {
            autoAlpha: 1,
            scale: 1,
            rotate: -4,
            duration: 0.38,
            ease: 'power3.in',
          },
        );
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(root, { autoAlpha: 1, rotate: -4 });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <span
      ref={rootRef}
      role="img"
      aria-label={label}
      className="inline-grid size-9 shrink-0 place-items-center rounded-[0.35rem] border-2 border-cinnabar font-display text-lg font-semibold text-cinnabar opacity-0 select-none"
    >
      {char}
    </span>
  );
}
