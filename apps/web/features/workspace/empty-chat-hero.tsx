import type { ReactNode } from 'react';
import { AmbientHalo } from './ambient-halo';

/** 空会话只呈现问题入口，不预先伪造教学对话或学习成果。 */
export function EmptyChatHero({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-16 sm:pb-20">
      <AmbientHalo />
      <section className="relative z-10 w-full -translate-y-6 text-center sm:-translate-y-8">
        <h1 className="mb-8 px-4 text-[clamp(2rem,3vw,2.75rem)] leading-tight font-normal tracking-[-0.045em] text-ink text-balance">
          你好，今天想学点什么？
        </h1>
        {children}
      </section>
    </main>
  );
}
