'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { SplitText } from 'gsap/SplitText';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP, SplitText, DrawSVGPlugin);

/**
 * 扉页问候：墨色衬线大字逐字落下，随后一道朱砂笔触在字底划过——
 * 「落笔」动效身份的第一现场。落字完成后逐字保留一层极缓的墨色呼吸（.hero-ink-char），
 * 让大字持续「活着」而不喧宾夺主。SplitText 的 aria 兜底保留原文，
 * E2E 的 heading 断言不受切分影响；reduced-motion 下全部静态渲染、无持续动效。
 */
export function HeroGreeting({ nickname }: { nickname?: string | null }) {
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
        /* 落字用 mask 遮住上冒的溢出；完成后换成无遮罩的普通切分承载持续呼吸，
           否则呼吸的位移会被 mask 裁掉字顶。loopSplit 在 revert 时一并回收。 */
        let loopSplit: SplitText | null = null;
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
                loopSplit = SplitText.create(heading, { type: 'chars' });
                loopSplit.chars.forEach((char, index) => {
                  const el = char as HTMLElement;
                  el.classList.add('hero-ink-char');
                  el.style.setProperty(
                    '--hero-char-delay',
                    `${(index * 0.11).toFixed(2)}s`,
                  );
                });
              },
            },
          )
          .fromTo(
            stroke,
            { drawSVG: '0%', autoAlpha: 1 },
            { drawSVG: '100%', duration: 0.5, ease: 'power2.inOut' },
            '-=0.25',
          );
        return () => {
          timeline.kill();
          loopSplit?.revert();
          split.revert();
        };
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
        {nickname ? `Hi ${nickname}，今天想学什么？` : '今天想学什么？'}
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
