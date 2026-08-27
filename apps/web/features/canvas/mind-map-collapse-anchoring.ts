import type { RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';

interface AnchorSnapshot {
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

/**
 * 折叠/展开的视口锚定补偿（mind-elixir 的 drift 补偿，从渲染器主体
 * 拆出以守住文件治理基线）。
 *
 * 用法：折叠前调用 captureAnchor(nodeId) 记录节点视口坐标；布局重算
 * 后 hook 内部的 layoutEffect 把该节点拉回原位，视野不漂移。平移量经
 * onDrift 交还渲染器——transform 状态归渲染器所有。
 */
export function useCollapseAnchoring(
  viewportRef: RefObject<HTMLElement | null>,
  layoutSignal: unknown,
  onDrift: (dx: number, dy: number) => void,
) {
  const pendingAnchorRef = useRef<AnchorSnapshot | null>(null);

  const captureAnchor = (nodeId: string) => {
    const section = viewportRef.current;
    const element = section?.querySelector<HTMLElement>(
      `[data-mindmap-node="${nodeId}"]`,
    );
    if (!element || !section) return;
    const rect = element.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    pendingAnchorRef.current = {
      nodeId,
      offsetX: rect.left - sectionRect.left,
      offsetY: rect.top - sectionRect.top,
    };
  };

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    const section = viewportRef.current;
    if (!anchor || !section) return;
    pendingAnchorRef.current = null;
    const element = section.querySelector<HTMLElement>(
      `[data-mindmap-node="${anchor.nodeId}"]`,
    );
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const dx = anchor.offsetX - (rect.left - sectionRect.left);
    const dy = anchor.offsetY - (rect.top - sectionRect.top);
    if (dx === 0 && dy === 0) return;
    onDrift(dx, dy);
  }, [layoutSignal, viewportRef, onDrift]);

  return { captureAnchor };
}
