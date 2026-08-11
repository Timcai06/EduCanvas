'use client';

import { useGSAP } from '@gsap/react';
import { MagicWand } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { motionDuration } from '@/features/theme/motion';

gsap.registerPlugin(useGSAP);

/** 工具在固定器物位显影，避免执行状态在消息流中到处跳。 */
export function DeskInkstoneIndicator({ label }: { label: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!label) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          rootRef.current,
          { y: 10, scale: 0.94, opacity: 0 },
          {
            y: 0,
            scale: 1,
            opacity: 1,
            duration: motionDuration('standard'),
            ease: 'back.out(1.5)',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [label], revertOnUpdate: true },
  );
  if (!label) return null;
  return (
    <div
      ref={rootRef}
      role="status"
      className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full border border-cinnabar/25 bg-card/94 px-3 py-2 text-xs text-ink-muted shadow-[var(--shadow-float)] backdrop-blur-xl"
      data-desk-inkstone
    >
      <span className="grid size-7 place-items-center rounded-full bg-cinnabar/10 text-cinnabar">
        <MagicWand size={15} weight="duotone" />
      </span>
      <span>
        <strong className="block font-semibold text-ink">正在取用</strong>
        {label}
      </span>
    </div>
  );
}
