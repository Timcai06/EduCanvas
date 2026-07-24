'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { HeroGreeting } from '../shared/hero-greeting';
import { HeroInkField } from '../shared/hero-ink-field';

gsap.registerPlugin(useGSAP);

/** 空会话只呈现问题入口，不预先伪造教学对话或学习成果。 */
export function EmptyChatHero({
  children,
  nickname,
}: {
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

  return (
    <main
      ref={rootRef}
      className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-16 sm:pb-20"
    >
      <HeroInkField />
      <section className="relative z-10 w-full -translate-y-6 text-center sm:-translate-y-8">
        <HeroGreeting nickname={nickname} />
        <div ref={contentRef}>{children}</div>
      </section>
    </main>
  );
}
