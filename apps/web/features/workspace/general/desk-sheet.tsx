'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, type ReactNode } from 'react';
import { motionDuration } from '@/features/theme/motion';

gsap.registerPlugin(useGSAP);

/** 资源从案边展开到中心的唯一工作面壳；只动画 transform/opacity。 */
export function DeskSheet({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          rootRef.current,
          {
            xPercent: 5,
            scale: 0.985,
            opacity: 0,
            willChange: 'transform,opacity',
          },
          {
            xPercent: 0,
            scale: 1,
            opacity: 1,
            duration: motionDuration('slow'),
            ease: 'power3.out',
            // 永久的 will-change: transform 会把 fixed Canvas 困在右侧栏的
            // containing block 中，导致“全屏”无法覆盖浏览器视口。
            clearProps: 'transform,opacity,willChange',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );
  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 min-w-0 flex-1"
      data-desk-sheet
    >
      {children}
    </div>
  );
}
