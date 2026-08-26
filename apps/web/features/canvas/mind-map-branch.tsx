import type { MindMapNode } from '@educanvas/canvas-protocol';

const DEPTH_STYLES = [
  'text-lg font-semibold text-ink',
  'text-body font-medium text-ink',
  'text-sm text-ink-muted',
  'text-sm text-ink-muted',
] as const;

/**
 * v1 树形回退展示（从渲染器主体拆出以守住文件治理基线）。
 * 仅服务 v1 历史格式的降级阅读；v2 一律走画布布局链路。
 */
export function MindMapBranch({
  node,
  depth,
}: {
  node: MindMapNode;
  depth: number;
}) {
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
            depth === 0
              ? 'bg-accent'
              : depth === 1
                ? 'bg-accent/60'
                : 'bg-ink-faint'
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
