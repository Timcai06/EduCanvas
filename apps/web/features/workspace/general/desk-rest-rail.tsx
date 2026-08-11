'use client';

import { useGSAP } from '@gsap/react';
import { FileText, Image as ImageIcon, Sparkle } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { motionDuration } from '@/features/theme/motion';
import type { SurfacePosition } from './surface-position-client';

gsap.registerPlugin(useGSAP);

/** 折到案边的资源仍保有空间身份；它不是历史列表，而是当前 Notebook 的静置纸页。 */
export function DeskRestRail({
  positions,
  onOpen,
}: {
  positions: readonly SurfacePosition[];
  onOpen: (position: SurfacePosition) => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const resting = positions
    .filter((position) => position.restState !== 'open')
    .slice(0, 6);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '[data-resting-sheet]',
          { x: 18, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: motionDuration('fast'),
            ease: 'power2.out',
            stagger: 0.045,
            clearProps: 'transform,opacity',
          },
        );
      });
      return () => media.revert();
    },
    {
      scope: rootRef,
      dependencies: [resting.map((position) => position.resourceId).join(':')],
      revertOnUpdate: true,
    },
  );

  if (resting.length === 0) return null;
  return (
    <aside
      ref={rootRef}
      aria-label="案边资料"
      className="absolute top-1/2 right-2 z-40 flex -translate-y-1/2 flex-col gap-2"
      data-desk-rest-rail
    >
      {resting.map((position, index) => (
        <button
          key={`${position.resourceKind}:${position.resourceId}`}
          type="button"
          data-resting-sheet
          onClick={() => onOpen(position)}
          className="group flex h-12 w-11 items-center justify-center rounded-l-xl border border-r-0 border-line/80 bg-card/92 text-ink-muted shadow-[var(--shadow-float)] backdrop-blur-md transition-[width,color,border-color] duration-200 hover:w-14 hover:border-accent/35 hover:text-accent-strong focus-visible:w-14"
          title={`${position.resourceKind === 'source' ? '资料' : '作品'} ${index + 1} · 点击展开`}
        >
          {position.resourceKind === 'artifact' ? (
            <Sparkle size={17} weight="duotone" />
          ) : index % 2 === 0 ? (
            <FileText size={17} weight="duotone" />
          ) : (
            <ImageIcon size={17} weight="duotone" />
          )}
        </button>
      ))}
    </aside>
  );
}
