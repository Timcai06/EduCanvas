'use client';

import type { GatewayConnectionAuthorization } from '@educanvas/gateway-core';
import { ArrowSquareOut } from '@phosphor-icons/react';
import type { RefObject } from 'react';

/** 显示渠道授权的下一步，并提供父级控制的程序化聚焦目标。 */
export function ConnectionAuthorization({
  authorization,
  headingRef,
}: {
  authorization: GatewayConnectionAuthorization;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <section
      data-settings-section
      className="rounded-3xl border border-accent/60 bg-accent-soft p-5 shadow-float"
    >
      <div className="flex gap-3">
        <ArrowSquareOut
          aria-hidden="true"
          size={22}
          className="mt-0.5 shrink-0 text-accent-strong"
        />
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm font-display text-base font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            还差一步
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            在十分钟内打开授权页面并向渠道发送预填的启动消息。完成后回到这里即可看到“已连接”。
          </p>
          <a
            href={authorization.url}
            target="_blank"
            rel="noreferrer"
            aria-label="前往完成连接（在新标签页打开）"
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-card hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            前往完成连接
            <ArrowSquareOut aria-hidden="true" size={15} />
          </a>
        </div>
      </div>
    </section>
  );
}
