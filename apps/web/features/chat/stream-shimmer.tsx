'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP);

/**
 * 等待首个流式字符时的占位 shimmer。高光层只做 transform 平移;
 * reduced-motion 下不创建 Timeline,灰条静态呈现。文案语义由父级 sr-only 提供。
 */
export function StreamShimmer() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '.stream-shimmer__glint',
          { xPercent: -130 },
          {
            xPercent: 330,
            duration: 1.4,
            ease: 'power1.inOut',
            repeat: -1,
            stagger: 0.16,
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} aria-hidden="true" className="stream-shimmer pt-1.5">
      <span className="stream-shimmer__line">
        <span className="stream-shimmer__glint" />
      </span>
      <span className="stream-shimmer__line">
        <span className="stream-shimmer__glint" />
      </span>
      <span className="stream-shimmer__line">
        <span className="stream-shimmer__glint" />
      </span>
    </div>
  );
}
