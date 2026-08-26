'use client';

import {
  mindMapContentSchema,
  type MindMapContent,
} from '@educanvas/canvas-protocol';
import {
  ArrowBendDownRight,
  CaretDown,
  CaretRight,
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
import { MindMapEdgeLayer } from './mind-map-edge-layer';
import { MindMapZoomControls } from './mind-map-zoom-controls';
import { RoleBadge } from './mind-map-role-badge';
import { useCollapseAnchoring } from './mind-map-collapse-anchoring';
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

  /* 折叠/展开的视口锚定补偿：细节在 useCollapseAnchoring，transform 归本组件 */
  const applyDrift = useCallback((dx: number, dy: number) => {
    setTransform((previous) => ({
      ...previous,
      offsetX: previous.offsetX + dx,
      offsetY: previous.offsetY + dy,
    }));
  }, []);
  const { captureAnchor } = useCollapseAnchoring(
    nodeRootRef,
    layout,
    applyDrift,
  );

  const requestZoom = useCallback(
    (nextScale: number, origin?: { x: number; y: number }) => {
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
    },
    [],
  );

  /* 控件缩放以视口中心为原点；滚轮/快捷键仍以光标为原点 */
  const zoomFromViewportCenter = useCallback(
    (nextScale: number) => {
      const rect = nodeRootRef.current?.getBoundingClientRect();
      if (!rect) {
        requestZoom(nextScale);
        return;
      }
      requestZoom(nextScale, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    },
    [requestZoom],
  );
  const handleZoomIn = useCallback(
    () => zoomFromViewportCenter(transform.scale + ZOOM_STEP),
    [transform.scale, zoomFromViewportCenter],
  );
  const handleZoomOut = useCallback(
    () => zoomFromViewportCenter(transform.scale - ZOOM_STEP),
    [transform.scale, zoomFromViewportCenter],
  );

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

  const toggleCollapse = (nodeId: string) => {
    captureAnchor(nodeId);
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
          <MindMapEdgeLayer
            edges={layout.edges}
            nodeById={nodeById}
            width={layout.width}
            height={layout.height}
          />
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
                <RoleBadge role={node.semanticRole} />
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
        <MindMapZoomControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFit={fitView}
        />
      </section>
      <span className="sr-only">
        {contentVersion === 1
          ? 'mind map v1 历史格式'
          : 'mind map v2 图结构格式'}
      </span>
    </CanvasSurface>
  );
}
