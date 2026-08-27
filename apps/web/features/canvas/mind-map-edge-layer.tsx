import type { MindMapViewEdge } from './mind-map-layout';

/**
 * 思维导图边层（从渲染器主体拆出以守住文件治理基线）：
 * 层级边继承目标节点分支色；非层级语义边保持灰色虚线。
 * 纯展示组件——几何全部由布局层算好，这里不做任何测量。
 */
export function MindMapEdgeLayer({
  edges,
  nodeById,
  width,
  height,
}: {
  edges: MindMapViewEdge[];
  nodeById: Map<string, { branchColorVar?: string }>;
  width: number;
  height: number;
}) {
  return (
    <svg
      className="pointer-events-none"
      width={width}
      height={height}
      aria-hidden="true"
    >
      {edges.map((edge) => {
        const branchColor = nodeById.get(edge.to)?.branchColorVar;
        const isSemantic =
          edge.semanticRole && edge.semanticRole !== 'hierarchy';
        return (
          <path
            key={`${edge.from}->${edge.to}`}
            d={`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`}
            {...(isSemantic
              ? {
                  stroke: 'currentColor',
                  className: 'text-ink-muted/45',
                  strokeDasharray: '5 5',
                }
              : {
                  stroke: branchColor ?? 'var(--color-accent)',
                  strokeOpacity: 0.45,
                })}
            strokeWidth={2}
            fill="none"
          />
        );
      })}
    </svg>
  );
}
