import { PET_SIZE, type Rect } from './pet-clamp';

export const COLLAPSED_PET_SIZE = PET_SIZE;
export const EXPANDED_PET_WIDTH = 360;
export const EXPANDED_PET_HEIGHT = 232;

/** 改变窗口尺寸时固定右下角，因此宠物本体不会在展开气泡时跳动。 */
export function resizePetWindowRect(rect: Rect, expanded: boolean): Rect {
  const width = expanded ? EXPANDED_PET_WIDTH : COLLAPSED_PET_SIZE;
  const height = expanded ? EXPANDED_PET_HEIGHT : COLLAPSED_PET_SIZE;
  return {
    x: rect.x + rect.width - width,
    y: rect.y + rect.height - height,
    width,
    height,
  };
}

/** 无论当前展开与否，返回应持久化的 128×128 宠物锚点。 */
export function collapsedAnchorRect(rect: Rect): Rect {
  return resizePetWindowRect(rect, false);
}
