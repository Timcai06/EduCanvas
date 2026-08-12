import { describe, expect, it } from 'vitest';
import {
  clampRect,
  initialPetRect,
  recoverOffscreenRect,
} from '../src/shared/pet-clamp';

const D = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const D2 = {
  x: 1920,
  y: 0,
  width: 1920,
  height: 1080,
  workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
};

describe('pet 窗口钳制', () => {
  it('在主屏 workArea 内不动', () => {
    expect(clampRect({ x: 100, y: 100, width: 128, height: 128 }, [D])).toEqual(
      {
        x: 100,
        y: 100,
        width: 128,
        height: 128,
      },
    );
  });

  it('右边越界钳回 workArea 内', () => {
    const r = clampRect({ x: 1900, y: 500, width: 128, height: 128 }, [D]);
    expect(r.x).toBeLessThanOrEqual(1920 - 128);
    expect(r.y).toBe(500);
  });

  it('完全在屏幕外时钳到最近的屏', () => {
    const r = clampRect({ x: -500, y: 500, width: 128, height: 128 }, [D]);
    expect(r.x).toBe(0);
  });

  it('跨屏时钳到重叠最多的屏', () => {
    // 窗口 x=1900..2028：与 D 重叠 20px、与 D2 重叠 108px → 钳入第二屏左缘
    const r = clampRect({ x: 1900, y: 500, width: 128, height: 128 }, [D, D2]);
    expect(r.x).toBe(1920);
  });

  it('窗口完全在两屏外时钳到最近的屏', () => {
    const r = clampRect({ x: 4000, y: 500, width: 128, height: 128 }, [D, D2]);
    expect(r.x).toBeLessThanOrEqual(3712);
    expect(r.x).toBeGreaterThanOrEqual(1920);
  });

  it('低于 workArea 顶边时钳回', () => {
    const r = clampRect({ x: 100, y: -50, width: 128, height: 128 }, [D]);
    expect(r.y).toBe(0);
  });

  it('初始位置在主屏底部居中', () => {
    expect(initialPetRect([D])).toEqual({
      x: (1920 - 128) / 2,
      y: 1040 - 128 - 40,
      width: 128,
      height: 128,
    });
  });

  it('奇数宽 workArea 居中取整（Electron 43 拒绝小数坐标）', () => {
    // 1707 宽的 workArea：(1707-128)/2 = 789.5 → 取整 790
    const odd = {
      ...D,
      workArea: { x: 0, y: 0, width: 1707, height: 1040 },
    };
    expect(initialPetRect([odd]).x).toBe(Math.round((1707 - 128) / 2));
    expect(Number.isInteger(initialPetRect([odd]).x)).toBe(true);
  });

  it('does not constrain a freely dragged window while its pet area remains visible', () => {
    const freelyDragged = { x: -120, y: 200, width: 500, height: 240 };
    const petGrabArea = { x: 343, y: 82, width: 120, height: 133 };

    expect(recoverOffscreenRect(freelyDragged, petGrabArea, [D])).toEqual(
      freelyDragged,
    );
  });

  it('allows dragging through the taskbar strip while the pet remains on the full display', () => {
    const overTaskbar = { x: 1000, y: 839, width: 500, height: 240 };
    const petGrabArea = { x: 343, y: 82, width: 120, height: 133 };

    expect(recoverOffscreenRect(overTaskbar, petGrabArea, [D])).toEqual(
      overTaskbar,
    );
  });

  it('keeps the complete draggable pet area inside the full display bottom edge', () => {
    const belowTaskbar = { x: 1000, y: 939, width: 500, height: 240 };
    const petGrabArea = { x: 343, y: 82, width: 120, height: 133 };

    expect(recoverOffscreenRect(belowTaskbar, petGrabArea, [D])).toEqual({
      x: 1000,
      y: 865,
      width: 500,
      height: 240,
    });
  });

  it('keeps the complete draggable pet area inside the left screen edge', () => {
    const beyondLeftEdge = { x: -400, y: 200, width: 500, height: 240 };
    const petGrabArea = { x: 343, y: 82, width: 120, height: 133 };

    expect(recoverOffscreenRect(beyondLeftEdge, petGrabArea, [D])).toEqual({
      x: -343,
      y: 200,
      width: 500,
      height: 240,
    });
  });

  it('recovers a window left on a disconnected display', () => {
    const disconnected = { x: 2200, y: 200, width: 500, height: 240 };
    const petGrabArea = { x: 343, y: 82, width: 120, height: 133 };

    expect(recoverOffscreenRect(disconnected, petGrabArea, [D])).toEqual({
      x: 1457,
      y: 200,
      width: 500,
      height: 240,
    });
  });

  it('recovers when only a non-draggable chat edge remains onscreen', () => {
    const chatEdgeOnly = { x: 1900, y: 200, width: 500, height: 240 };
    const petGrabArea = { x: 343, y: 82, width: 120, height: 133 };

    expect(recoverOffscreenRect(chatEdgeOnly, petGrabArea, [D]).x).toBe(1457);
  });
});
