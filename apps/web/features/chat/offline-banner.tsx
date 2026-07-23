'use client';

import { useGSAP } from '@gsap/react';
import { WifiSlash } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { OFFLINE_BANNER_TEXT } from './connection-status';

gsap.registerPlugin(useGSAP);

/**
 * 离线横幅：本机网络断开时在对话上方轻声提示，不打断也不遮挡。用 warn（藤黄）
 * 而非 bad（朱砂）——这是环境提示不是错误，恢复后自行消失。挂载时柔和落下，
 * reduced-motion 直接静态呈现。仅在离线时由父组件挂载。
 */
export function OfflineBanner() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(rootRef.current, {
          autoAlpha: 0,
          y: -6,
          duration: 0.3,
          ease: 'power2.out',
        });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      role="status"
      className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-1.5 text-xs font-medium text-warn"
    >
      <WifiSlash aria-hidden="true" size={14} weight="bold" />
      {OFFLINE_BANNER_TEXT}
    </div>
  );
}
