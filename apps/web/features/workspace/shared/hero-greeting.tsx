'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { SplitText } from 'gsap/SplitText';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP, SplitText, DrawSVGPlugin);

/**
 * 扉页问候：墨色衬线大字逐字落下，随后一道朱砂笔触在字底划过——
 * 「落笔」动效身份的第一现场。SplitText 的 aria 兜底保留原文，
 * E2E 的 heading 断言不受切分影响；reduced-motion 下全部静态渲染。
 */
export function HeroGreeting() {
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);

  useGSAP(
    () => {
      const heading = headingRef.current;
      const stroke = strokeRef.current;
      if (!heading || !stroke) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        heading.classList.add('is-splitting');
        const split = SplitText.create(heading, {
          type: 'chars',
          mask: 'chars',
        });
        const timeline = gsap.timeline();
        timeline
          .fromTo(
            split.chars,
            { yPercent: 108, autoAlpha: 0 },
            {
              yPercent: 0,
              autoAlpha: 1,
              duration: 0.65,
              stagger: 0.04,
              ease: 'power3.out',
              delay: 0.12,
              onComplete: () => {
                split.revert();
                heading.classList.remove('is-splitting');
              },
            },
          )
          .fromTo(
            stroke,
            { drawSVG: '0%', autoAlpha: 1 },
            { drawSVG: '100%', duration: 0.5, ease: 'power2.inOut' },
            '-=0.25',
          );
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(stroke, { autoAlpha: 1 });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="mb-9 px-4">
      <h1
        ref={headingRef}
        className="hero-ink-text text-[clamp(1.9rem,3vw,2.6rem)] leading-snug tracking-[0.01em] text-balance"
      >
        今天想学点什么？
      </h1>
      {/* 朱砂笔触下划线：宽度跟随文字盒，起笔重收笔轻 */}
      <svg
        aria-hidden="true"
        viewBox="0 0 220 10"
        className="mx-auto mt-3 h-2.5 w-44 sm:w-52"
        fill="none"
        preserveAspectRatio="none"
      >
        <path
          ref={strokeRef}
          d="M4 6.5C42 3.5 96 2.8 132 3.8c30 0.8 60 1.8 84 1.4"
          stroke="var(--color-cinnabar)"
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.85"
          style={{ visibility: 'hidden' }}
        />
      </svg>
    </div>
  );
}
