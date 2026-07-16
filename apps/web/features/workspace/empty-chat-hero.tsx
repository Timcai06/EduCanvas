'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { AmbientHalo } from './ambient-halo';

gsap.registerPlugin(useGSAP);

/** 空会话只呈现问题入口，不预先伪造教学对话或学习成果。 */
export function EmptyChatHero({ children }: { children: ReactNode }) {
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
            delay: 0.12,
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
      <AmbientHalo />
      <section className="relative z-10 w-full -translate-y-6 text-center sm:-translate-y-8">
        <div ref={contentRef}>
          <h1 className="mb-8 px-4 text-[clamp(2rem,3vw,2.75rem)] leading-tight font-normal tracking-[-0.045em] text-ink text-balance">
            你好，今天想探索什么？
          </h1>
          {children}
        </div>
      </section>
    </main>
  );
}
