/**
 * 桌宠窗口多屏钳制（纯函数，spec §3）。
 * 永不把窗口丢到屏幕外：钳到重叠最多的 display workArea 内，
 * 完全不重叠时钳到最近的屏。
 */

export interface DisplayInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  workArea: { x: number; y: number; width: number; height: number };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PET_SIZE = 128;
const BOTTOM_MARGIN = 40;

function overlap(
  a: Rect,
  b: { x: number; y: number; width: number; height: number },
): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function centerDistance(
  a: Rect,
  b: { x: number; y: number; width: number; height: number },
): number {
  const cx = a.x + a.width / 2 - (b.x + b.width / 2);
  const cy = a.y + a.height / 2 - (b.y + b.height / 2);
  return cx * cx + cy * cy;
}

/** 把窗口钳到重叠最多的 display workArea 内（完全无重叠时钳到中心距离最近的屏）。 */
export function clampRect(rect: Rect, displays: DisplayInfo[]): Rect {
  const ranked = displays
    .map((d) => ({ d, o: overlap(rect, d.workArea) }))
    .sort((a, b) => b.o - a.o);
  const nearest = displays
    .map((d) => ({ d, dist: centerDistance(rect, d.workArea) }))
    .sort((a, b) => a.dist - b.dist)[0]?.d;
  const best =
    (ranked[0] !== undefined && ranked[0].o > 0 ? ranked[0].d : nearest) ??
    displays[0];
  if (!best) return rect;
  const wa = best.workArea;
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, wa.x), wa.x + wa.width - rect.width),
    y: Math.min(Math.max(rect.y, wa.y), wa.y + wa.height - rect.height),
  };
}

/**
 * 让实际可拖动的角色区域始终完整落在现有显示器边界内；聊天框和透明窗口边距可以越界。
 * 相邻屏幕共同覆盖完整角色时保持跨屏位置，避免跨屏拖动被吸回单屏。
 */
export function recoverOffscreenRect(
  rect: Rect,
  localGrabArea: Rect,
  displays: DisplayInfo[],
): Rect {
  const screenGrabArea = {
    ...localGrabArea,
    x: rect.x + localGrabArea.x,
    y: rect.y + localGrabArea.y,
  };
  const ranked = displays
    .map((display) => ({
      display,
      overlap: overlap(screenGrabArea, display),
      distance: centerDistance(screenGrabArea, display),
    }))
    .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance);
  const coveredArea = ranked.reduce((sum, item) => sum + item.overlap, 0);
  if (coveredArea >= localGrabArea.width * localGrabArea.height) return rect;

  const displayBounds = ranked[0]?.display;
  if (!displayBounds) return rect;
  const minX = displayBounds.x - localGrabArea.x;
  const maxX =
    displayBounds.x +
    displayBounds.width -
    localGrabArea.x -
    localGrabArea.width;
  const minY = displayBounds.y - localGrabArea.y;
  const maxY =
    displayBounds.y +
    displayBounds.height -
    localGrabArea.y -
    localGrabArea.height;
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, minX), maxX),
    y: Math.min(Math.max(rect.y, minY), maxY),
  };
}

/** 初始位置：主屏（displays[0]）workArea 底部居中，留底边距。
 * 坐标取整：Electron 43 的 setPosition 拒绝小数像素。 */
export function initialPetRect(displays: DisplayInfo[]): Rect {
  const primary = displays[0] ?? {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  };
  const wa = primary.workArea;
  return {
    x: Math.round(wa.x + (wa.width - PET_SIZE) / 2),
    y: Math.round(wa.y + wa.height - PET_SIZE - BOTTOM_MARGIN),
    width: PET_SIZE,
    height: PET_SIZE,
  };
}
