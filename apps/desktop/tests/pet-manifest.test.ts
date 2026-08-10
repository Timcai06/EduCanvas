import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/shared/pet-manifest';

const VALID = {
  frameWidth: 32,
  frameHeight: 32,
  fps: 8,
  anchor: { x: 16, y: 32 },
  states: {
    idle: { frames: [0, 1], fps: 4, loop: true },
    walk: { frames: [2, 3, 4, 5], fps: 10, loop: true },
    think: { frames: [6, 7], fps: 4, loop: true },
    speak: { frames: [8], fps: 8, loop: true },
    success: { frames: [9], fps: 8, loop: false },
    error: { frames: [10], fps: 8, loop: false },
  },
};

describe('pet manifest 解析', () => {
  it('合法 manifest 通过并返回结构化结果', () => {
    expect(() => parseManifest(VALID)).not.toThrow();
    expect(parseManifest(VALID).states.speak?.frames).toEqual([8]);
    expect(parseManifest(VALID).anchor).toEqual({ x: 16, y: 32 });
  });

  it('缺失状态名报错（指明缺哪个）', () => {
    const bad = structuredClone(VALID) as Record<string, unknown>;
    delete (bad.states as Record<string, unknown>).speak;
    expect(() => parseManifest(bad)).toThrow(/speak/);
  });

  it('帧索引非负整数校验（负数/小数/NaN 报错）', () => {
    const bad = structuredClone(VALID) as { states: Record<string, { frames: number[] }> };
    const speak = bad.states.speak;
    expect(speak).toBeDefined();
    if (speak) {
      speak.frames = [-1];
      expect(() => parseManifest(bad)).toThrow();
      speak.frames = [1.5];
      expect(() => parseManifest(bad)).toThrow();
    }
  });

  it('帧尺寸非正整数报错', () => {
    expect(() => parseManifest({ ...VALID, frameWidth: 0 })).toThrow(/frameWidth/);
    expect(() => parseManifest({ ...VALID, fps: -1 })).toThrow(/fps/);
  });

  it('非对象/缺锚点报错', () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest(42)).toThrow();
    const bad = structuredClone(VALID) as Record<string, unknown>;
    delete bad.anchor;
    expect(() => parseManifest(bad)).toThrow(/anchor/);
  });
});
