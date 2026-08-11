import { describe, expect, it } from 'vitest';
import { dragTarget } from '../src/shared/pet-drag';

describe('pet 拖动目标位置', () => {
  it('目标 = 屏幕坐标 - 抓取偏移', () => {
    expect(
      dragTarget({ screenX: 500, screenY: 300, offsetX: 40, offsetY: 20 }),
    ).toEqual({ x: 460, y: 280 });
  });

  it('窗口左上角抓取（偏移 0）时目标 = 屏幕坐标', () => {
    expect(
      dragTarget({ screenX: 120, screenY: 80, offsetX: 0, offsetY: 0 }),
    ).toEqual({ x: 120, y: 80 });
  });

  it('窗口右下角抓取时目标左移（保证指针不跳）', () => {
    expect(
      dragTarget({ screenX: 700, screenY: 500, offsetX: 128, offsetY: 128 }),
    ).toEqual({ x: 572, y: 372 });
  });
});
