'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { ElementType, ReactNode } from 'react';
import { useRef } from 'react';
import { HeroGreeting } from './hero-greeting';
import { HeroInkField } from './hero-ink-field';
import { TechnologyBrandLoop } from './technology-brand-loop';

gsap.registerPlugin(useGSAP);

/**
 * 空会话只呈现问题入口，不预先伪造教学对话或学习成果。
 *
 * 页面入口默认使用 main；已处于工作区 main 内时传 section，避免重复主内容地标。
 */
export function EmptyChatHero({
  as: Root = 'main',
  children,
  nickname,
}: {
  as?: 'main' | 'section';
  children: ReactNode;
  nickname?: string | null;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const content = contentRef.current;
      if (!content) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          content,
          { autoAlpha: 0, y: 14 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.72,
            delay: 0.3,
            ease: 'power2.out',
          },
        );
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(content, { autoAlpha: 1, y: 0 });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  const RootElement = Root as ElementType;
  return (
    <RootElement
      ref={rootRef}
      className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-16 sm:pb-20"
    >
      <HeroInkField />
      <div className="relative z-10 w-full -translate-y-6 text-center sm:-translate-y-8">
        <HeroGreeting nickname={nickname} />
        <div ref={contentRef}>{children}</div>
      </div>
      <TechnologyBrandLoop />
    </RootElement>
  );
}
