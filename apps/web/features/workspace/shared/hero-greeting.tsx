'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP, SplitText);

/**
 * 渐变问候语 + SplitText 逐字入场。SplitText 默认 aria 会在标题上保留原文的
 * aria-label,E2E 的 getByRole heading 断言不受切分影响;reduced-motion 下
 * 完全不切分,静态渲染保证视觉基线像素稳定。
 */
export function HeroGreeting() {
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const heading = headingRef.current;
      if (!heading) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        /*
         * 渐变来自 background-clip: text。切分后每个 char 继承整行渐变的
         * 对应片段,拼合结果与未切分一致,掩码 reveal 不破坏配色。
         */
        heading.classList.add('is-splitting');
        const split = SplitText.create(heading, {
          type: 'chars',
          mask: 'chars',
        });
        gsap.fromTo(
          split.chars,
          { yPercent: 108, autoAlpha: 0 },
          {
            yPercent: 0,
            autoAlpha: 1,
            duration: 0.7,
            stagger: 0.035,
            ease: 'power3.out',
            delay: 0.15,
            onComplete: () => {
              split.revert();
              heading.classList.remove('is-splitting');
            },
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef}>
      <h1
        ref={headingRef}
        className="hero-gradient-text mb-8 px-4 text-[clamp(2rem,3vw,2.75rem)] leading-tight font-normal tracking-[-0.045em] text-balance"
      >
        你好，今天想探索什么？
      </h1>
    </div>
  );
}
