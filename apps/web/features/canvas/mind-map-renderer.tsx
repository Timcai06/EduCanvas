'use client';

import { mindMapContentSchema, type MindMapNode } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useMemo, useRef } from 'react';

gsap.registerPlugin(useGSAP);

/**
 * 思维导图渲染器(Tier 1 预注册组件)。入口重新过公开 Schema:
 * 数据库内容理论上已校验,但渲染器不信任上游,坏结构显示错误而不是崩溃。
 */
export function MindMapRenderer({ content }: { content: unknown }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => mindMapContentSchema.safeParse(content), [content]);

  useGSAP(
    () => {
      if (!parsed.success) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '.mind-map-node',
          { autoAlpha: 0, x: -8 },
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.3,
            stagger: 0.04,
            ease: 'power2.out',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [parsed] },
  );

  if (!parsed.success) {
    return (
      <p role="alert" className="rounded-xl bg-bad-soft p-3 text-bad">
        这份思维导图的内容格式有问题，无法显示。
      </p>
    );
  }

  return (
    <div ref={rootRef} className="min-w-0" data-mind-map>
      <MindMapBranch node={parsed.data.root} depth={0} />
    </div>
  );
}

const DEPTH_STYLES = [
  'text-lg font-semibold text-ink',
  'text-[15px] font-medium text-ink',
  'text-sm text-ink-muted',
  /* 最深层节点仍是可读内容，用 ink-muted 保 AA；层级差由左缩进承载而非更淡的字色 */
  'text-sm text-ink-muted',
] as const;

function MindMapBranch({ node, depth }: { node: MindMapNode; depth: number }) {
  return (
    <div className={depth === 0 ? '' : 'border-l border-line/70 pl-4'}>
      <p
        className={`mind-map-node flex min-h-8 items-center gap-2 py-1 ${
          DEPTH_STYLES[Math.min(depth, DEPTH_STYLES.length - 1)]
        }`}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${
            depth === 0 ? 'bg-accent' : depth === 1 ? 'bg-accent/60' : 'bg-ink-faint'
          }`}
        />
        {node.label}
      </p>
      {node.children && node.children.length > 0 ? (
        <div className="ml-[3px] space-y-0.5">
          {node.children.map((child) => (
            <MindMapBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
