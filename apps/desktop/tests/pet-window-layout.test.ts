import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_PET_SIZE,
  EXPANDED_PET_HEIGHT,
  EXPANDED_PET_WIDTH,
  collapsedAnchorRect,
  resizePetWindowRect,
} from '../src/shared/pet-window-layout';

describe('桌宠窗口展开布局', () => {
  it('展开时保持宠物所在的右下角锚点不动', () => {
    expect(
      resizePetWindowRect({ x: 1000, y: 700, width: 128, height: 128 }, true),
    ).toEqual({
      x: 1000 + COLLAPSED_PET_SIZE - EXPANDED_PET_WIDTH,
      y: 700 + COLLAPSED_PET_SIZE - EXPANDED_PET_HEIGHT,
      width: EXPANDED_PET_WIDTH,
      height: EXPANDED_PET_HEIGHT,
    });
  });

  it('收起时恢复右下角 128px 宠物矩形', () => {
    const expanded = { x: 768, y: 596, width: 360, height: 232 };
    expect(resizePetWindowRect(expanded, false)).toEqual({
      x: 1000,
      y: 700,
      width: 128,
      height: 128,
    });
    expect(collapsedAnchorRect(expanded)).toEqual({
      x: 1000,
      y: 700,
      width: 128,
      height: 128,
    });
  });
});
