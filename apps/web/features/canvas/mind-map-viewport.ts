import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { MindMapLayout } from './mind-map-layout';

const MAX_ZOOM = 2.4;
const MIN_ZOOM = 0.12;
export const ZOOM_STEP = 0.15;

export const clampScale = (scale: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

export interface MindMapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * 思维导图视口：缩放、平移与首次自适应。
 *
 * 缩放归属是这里唯一需要小心的事。`fitView` 整体覆写 transform（含 scale），
 * 而折叠/展开会重算 layout，因此不能让「layout 变化」直接驱动 fitView——那会
 * 把用户手动放大的倍率打回 fit-to-view，点一次折叠按钮画面就跳一下（#488）。
 * 规则：只在首次拿到 layout 时自适应一次；此后缩放归用户，折叠引起的位移由
 * useCollapseAnchoring 单独补偿。ResizeObserver 同理，只在用户未手动缩放
 * （scale === 1）时才重新适配容器。
 */
export function useMindMapViewport(
  viewportRef: RefObject<HTMLDivElement | null>,
  layout: MindMapLayout | null,
) {
  const [transform, setTransform] = useState<MindMapTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  /* ResizeObserver 回调要读最新 scale，但 transform 不能进 effect 依赖
     （否则每次平移/缩放都重建 observer）。用 ref 旁路读取。 */
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const fitView = useCallback(() => {
    if (!layout || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
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
  }, [layout, viewportRef]);

  const didFitRef = useRef(false);
  useLayoutEffect(() => {
    if (!layout) return;
    if (!didFitRef.current) {
      didFitRef.current = true;
      fitView();
    }

    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      if (transformRef.current.scale === 1) fitView();
    });
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [fitView, layout, viewportRef]);

  /* 折叠/展开的视口锚定补偿：只动平移，不碰 scale。 */
  const applyDrift = useCallback((dx: number, dy: number) => {
    setTransform((previous) => ({
      ...previous,
      offsetX: previous.offsetX + dx,
      offsetY: previous.offsetY + dy,
    }));
  }, []);

  const requestZoom = useCallback(
    (nextScale: number, origin?: { x: number; y: number }) => {
      setTransform((previous) => {
        const to = clampScale(nextScale);
        if (origin && viewportRef.current) {
          const rect = viewportRef.current.getBoundingClientRect();
          const cursorX = origin.x - rect.left;
          const cursorY = origin.y - rect.top;
          const worldX = (cursorX - previous.offsetX) / previous.scale;
          const worldY = (cursorY - previous.offsetY) / previous.scale;
          return {
            scale: to,
            offsetX: cursorX - worldX * to,
            offsetY: cursorY - worldY * to,
          };
        }
        return { ...previous, scale: to };
      });
    },
    [viewportRef],
  );

  /* 控件与键盘缩放以视口中心为原点；滚轮以光标为原点。 */
  const zoomFromViewportCenter = useCallback(
    (nextScale: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) {
        requestZoom(nextScale);
        return;
      }
      requestZoom(nextScale, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    },
    [requestZoom, viewportRef],
  );

  return {
    transform,
    setTransform,
    fitView,
    applyDrift,
    requestZoom,
    zoomFromViewportCenter,
  };
}
