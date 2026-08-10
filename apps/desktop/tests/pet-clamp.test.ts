import { describe, expect, it } from 'vitest';
import { clampRect, initialPetRect } from '../src/shared/pet-clamp';

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
    expect(clampRect({ x: 100, y: 100, width: 128, height: 128 }, [D])).toEqual({
      x: 100,
      y: 100,
      width: 128,
      height: 128,
    });
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
});
