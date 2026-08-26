'use client';

import {
  mindMapContentSchema,
  type MindMapContent,
  type MindMapNode,
} from '@educanvas/canvas-protocol';
import {
  ArrowBendDownRight,
  CaretDown,
  CaretRight,
  CornersOut,
  Lightning,
  Minus,
  Notepad,
  Plus,
  Question,
} from '@phosphor-icons/react';
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { CanvasSurface } from './canvas-surface';
import {
  MIND_MAP_ASK_NODE_EVENT,
  MIND_MAP_NODE_HEIGHT,
  MIND_MAP_NODE_WIDTH,
  buildAskNodeEventPayload,
  buildMindMapLayout,
  nextVisibleNode,
  type MindMapKeyDirection,
} from './mind-map-layout';

const MAX_ZOOM = 2.4;
const MIN_ZOOM = 0.12;
const ZOOM_STEP = 0.15;
const clampScale = (scale: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/** semanticRole 的可视化徽标：图标 + 语义色 token；未标注角色不显示。 */
const SEMANTIC_ROLE_ICONS = {
  question: { Icon: Question, className: 'text-warn' },
  annotation: { Icon: Notepad, className: 'text-accent' },
  action: { Icon: Lightning, className: 'text-good' },
} as const;

type OnAskNode = (payload: {
  nodeId: string;
  nodeLabel: string;
  requestedAt: number;
}) => void;

/**
 * 思维导图渲染器(Tier 1 预注册组件)。入口重新过公开 Schema:
 * 数据库内容理论上已校验,但渲染器不信任上游,坏结构显示错误而不是崩溃。
 * v1 与 v2 同时支持：v1 做树形兼容转换后按同一布局链路绘制。
 */
export function MindMapRenderer({
  content,
  onAskNode,
}: {
  content: unknown;
  onAskNode?: OnAskNode;
}) {
  const nodeRootRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  const parsed = useMemo(
    () => mindMapContentSchema.safeParse(content),
    [content],
  );

  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [transform, setTransform] = useState({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  /* 折叠锚定：记录点击节点的视口坐标，布局重算后把它拉回原位，
     折叠/展开不再导致视野漂移（mind-elixir 的 drift 补偿）。 */
  const pendingAnchorRef = useRef<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const layout = useMemo(
    () =>
      parsed.success ? buildMindMapLayout(parsed.data, collapsedNodeIds) : null,
    [parsed, collapsedNodeIds],
  );
  const visibleNodeIds = useMemo(() => layout?.visibleNodeIds ?? [], [layout]);
  const nodeById = useMemo(
    () => new Map((layout?.nodes ?? []).map((node) => [node.id, node])),
    [layout],
  );
  const effectiveFocusedNodeId =
    focusedNodeId && visibleNodeIds.includes(focusedNodeId)
      ? focusedNodeId
      : (visibleNodeIds[0] ?? null);

  const fitView = useCallback(() => {
    if (!layout || !nodeRootRef.current) return;
    const rect = nodeRootRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scale = clampScale(
      Math.min(
        (rect.width - 32) / layout.width,
        (rect.height - 32) / layout.height,
      ),
    );
    setTransform({
      scale,
      offsetX: (rect.width - layout.width * scale) / 2,
      offsetY: (rect.height - layout.height * scale) / 2,
    });
  }, [layout]);

  useLayoutEffect(() => {
    fitView();

    const viewport = nodeRootRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => fitView());
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [fitView]);

  useEffect(() => {
    if (!effectiveFocusedNodeId || !nodeRootRef.current) return;
    nodeRootRef.current
      .querySelector<HTMLElement>(
        `[data-mindmap-node="${effectiveFocusedNodeId}"]`,
      )
      ?.focus();
  }, [effectiveFocusedNodeId, layout]);

  /* 折叠/展开重排后执行：把锚定节点拉回点击前的视口位置。 */
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    const section = nodeRootRef.current;
    if (!anchor || !section) return;
    pendingAnchorRef.current = null;
    const element = section.querySelector<HTMLElement>(
      `[data-mindmap-node="${anchor.nodeId}"]`,
    );
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const dx =
      anchor.offsetX - (rect.left - section.getBoundingClientRect().left);
    const dy =
      anchor.offsetY - (rect.top - section.getBoundingClientRect().top);
    if (dx === 0 && dy === 0) return;
    setTransform((previous) => ({
      ...previous,
      offsetX: previous.offsetX + dx,
      offsetY: previous.offsetY + dy,
    }));
  }, [layout]);

  if (!parsed.success || layout === null) {
    return (
      <p role="alert" className="rounded-xl bg-bad-soft p-3 text-bad">
        这份思维导图的内容格式有问题，无法显示。
      </p>
    );
  }

  const contentVersion = (parsed.data as MindMapContent).contentVersion;

  const emitAskNode = (nodeId: string, label: string) => {
    const payload = buildAskNodeEventPayload(nodeId, label);
    if (onAskNode) onAskNode(payload);
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(MIND_MAP_ASK_NODE_EVENT, {
        detail: payload,
      }),
    );
  };

  const requestZoom = (
    nextScale: number,
    origin?: { x: number; y: number },
  ) => {
    setTransform((previous) => {
      const to = clampScale(nextScale);
      if (origin && nodeRootRef.current) {
        const rect = nodeRootRef.current.getBoundingClientRect();
        const cursorX = origin.x - rect.left;
        const cursorY = origin.y - rect.top;
        const worldX = (cursorX - previous.offsetX) / previous.scale;
        const worldY = (cursorY - previous.offsetY) / previous.scale;
        const offsetX = cursorX - worldX * to;
        const offsetY = cursorY - worldY * to;
        return { scale: to, offsetX, offsetY };
      }
      return { ...previous, scale: to };
    });
  };

  /* 控件缩放以视口中心为原点；滚轮/快捷键仍以光标为原点 */
  const zoomFromViewportCenter = (nextScale: number) => {
    const rect = nodeRootRef.current?.getBoundingClientRect();
    if (!rect) {
      requestZoom(nextScale);
      return;
    }
    requestZoom(nextScale, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  const toggleCollapse = (nodeId: string) => {
    const section = nodeRootRef.current;
    const element = section?.querySelector<HTMLElement>(
      `[data-mindmap-node="${nodeId}"]`,
    );
    if (element && section) {
      const rect = element.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      pendingAnchorRef.current = {
        nodeId,
        offsetX: rect.left - sectionRect.left,
        offsetY: rect.top - sectionRect.top,
      };
    }
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const moveFocus = (direction: MindMapKeyDirection) => {
    const next = nextVisibleNode(
      visibleNodeIds,
      effectiveFocusedNodeId,
      direction,
    );
    if (next === null) return;
    setFocusedNodeId(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus('up');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus('down');
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const node = layout.nodes.find(
        (item) => item.id === effectiveFocusedNodeId,
      );
      if (!node) {
        moveFocus('left');
        return;
      }
      if (node.hasChildren && !collapsedNodeIds.has(node.id)) {
        toggleCollapse(node.id);
      }
      moveFocus('left');
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const node = layout.nodes.find(
        (item) => item.id === effectiveFocusedNodeId,
      );
      if (node?.hasChildren) {
        if (collapsedNodeIds.has(node.id)) toggleCollapse(node.id);
        if (node.children.length > 0) {
          setFocusedNodeId(node.children[0]!);
          return;
        }
      }
      moveFocus('right');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!effectiveFocusedNodeId) return;
      const node = layout.nodes.find(
        (item) => item.id === effectiveFocusedNodeId,
      );
      if (node) emitAskNode(node.id, node.label);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      requestZoom(transform.scale + ZOOM_STEP, {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      requestZoom(transform.scale - ZOOM_STEP, {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      setTransform({ scale: 1, offsetX: 0, offsetY: 0 });
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const next = transform.scale + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    requestZoom(next, { x: event.clientX, y: event.clientY });
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-mindmap-control]')) return;
    activePointerRef.current = event.pointerId;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
  };

  const handleDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0)
      return stopDrag(event);
    const deltaX = event.clientX - dragStart.current.x;
    const deltaY = event.clientY - dragStart.current.y;
    setTransform((previous) => ({
      ...previous,
      offsetX: dragStart.current.offsetX + deltaX,
      offsetY: dragStart.current.offsetY + deltaY,
    }));
  };

  return (
    <CanvasSurface
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-mind-map
    >
      <section
        ref={nodeRootRef}
        className="mind-map-viewport relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line/60 bg-card/80 p-2 outline-none"
        data-mind-map-viewport
        role="tree"
        tabIndex={0}
        aria-label="思维导图"
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onPointerDown={startDrag}
        onPointerMove={handleDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
        style={{ touchAction: 'none' }}
      >
        <div
          className="mind-map-canvas pointer-events-none absolute inset-0"
          style={{
            transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className="pointer-events-none"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => {
              /* 层级边继承目标节点的分支色；非层级语义边保持灰色虚线 */
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
          {layout.nodes.map((node) => {
            const isCollapsed = collapsedNodeIds.has(node.id);
            const isFocused = node.id === effectiveFocusedNodeId;
            return (
              <div
                key={node.id}
                data-mindmap-node={node.id}
                role="treeitem"
                aria-level={node.depth + 1}
                aria-expanded={
                  node.children.length > 0 ? !isCollapsed : undefined
                }
                aria-selected={isFocused}
                tabIndex={isFocused ? 0 : -1}
                onFocus={() => setFocusedNodeId(node.id)}
                onClick={() => setFocusedNodeId(node.id)}
                className={`pointer-events-auto absolute flex items-center gap-1 rounded-2xl border bg-card/95 px-3 py-2 text-sm text-ink shadow-[0_12px_36px_rgb(41_33_63_/_0.08)] backdrop-blur transition-[border-color,background-color,box-shadow] motion-reduce:transition-none ${
                  isFocused
                    ? 'border-accent bg-accent-soft/80 shadow-[0_14px_42px_rgb(101_79_155_/_0.2)]'
                    : 'border-line/70 hover:border-accent/60 hover:bg-card'
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: MIND_MAP_NODE_WIDTH,
                  minHeight: MIND_MAP_NODE_HEIGHT,
                }}
              >
                {/* 分支色条：一级取模分配、子树继承；root 用既有 accent 强调 */}
                {node.depth > 0 && node.branchColorVar ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 bottom-2 left-1 w-[3px] rounded-full"
                    style={{ backgroundColor: node.branchColorVar }}
                  />
                ) : null}
                {node.hasChildren ? (
                  <button
                    type="button"
                    data-mindmap-control
                    aria-label={
                      isCollapsed
                        ? `展开节点子分支（${node.descendantCount} 个后代）`
                        : '折叠节点子分支'
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCollapse(node.id);
                    }}
                    className={`inline-flex shrink-0 items-center justify-center gap-0.5 border border-line/60 text-ink-muted transition hover:bg-line/20 ${
                      isCollapsed
                        ? 'h-5 min-w-9 rounded-full px-1'
                        : 'size-5 rounded-full'
                    }`}
                  >
                    {isCollapsed ? (
                      <>
                        <CaretRight size={12} />
                        <span className="text-[9px] leading-none">
                          {node.descendantCount}
                        </span>
                      </>
                    ) : (
                      <CaretDown size={12} />
                    )}
                  </button>
                ) : (
                  <span className="inline-flex h-5 w-5 shrink-0" />
                )}
                {(() => {
                  const roleIcon =
                    SEMANTIC_ROLE_ICONS[
                      node.semanticRole as keyof typeof SEMANTIC_ROLE_ICONS
                    ];
                  if (!roleIcon) return null;
                  const RoleIcon = roleIcon.Icon;
                  return (
                    <RoleIcon
                      aria-hidden="true"
                      size={13}
                      className={`shrink-0 ${roleIcon.className}`}
                    />
                  );
                })()}
                <span className="inline-flex grow truncate text-left">
                  {node.label}
                </span>
                <button
                  type="button"
                  data-mindmap-control
                  aria-label={`提问：${node.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    emitAskNode(node.id, node.label);
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line/60 text-ink-muted transition hover:bg-line/20"
                >
                  <Question size={13} />
                </button>
                <span className="sr-only">{node.semanticRole ?? '节点'}</span>
                {node.id === layout.rootId ? (
                  <ArrowBendDownRight size={12} />
                ) : null}
              </div>
            );
          })}
        </div>
        {/* 缩放控件浮层：不再依赖盲快捷键；data-mindmap-control 豁免画布拖拽 */}
        <div
          className="absolute right-3 bottom-3 z-10 flex flex-col gap-1.5"
          data-mindmap-control
        >
          {[
            {
              label: '放大',
              icon: Plus,
              action: () => zoomFromViewportCenter(transform.scale + ZOOM_STEP),
            },
            {
              label: '缩小',
              icon: Minus,
              action: () => zoomFromViewportCenter(transform.scale - ZOOM_STEP),
            },
            { label: '适应画布', icon: CornersOut, action: fitView },
          ].map(({ label, icon: Icon, action }) => (
            <button
              key={label}
              type="button"
              data-mindmap-control
              aria-label={label}
              title={label}
              onClick={action}
              className="grid size-8 place-items-center rounded-full border border-line/70 bg-card/95 text-ink-muted shadow-sm backdrop-blur transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon aria-hidden="true" size={14} />
            </button>
          ))}
        </div>
      </section>
      <span className="sr-only">
        {contentVersion === 1
          ? 'mind map v1 历史格式'
          : 'mind map v2 图结构格式'}
      </span>
    </CanvasSurface>
  );
}

const DEPTH_STYLES = [
  'text-lg font-semibold text-ink',
  'text-body font-medium text-ink',
  'text-sm text-ink-muted',
  'text-sm text-ink-muted',
] as const;

/**
 * v1 回退展示兼容：保留仅对树渲染器场景的导出，避免其他上下文误用。
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
