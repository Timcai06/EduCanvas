import { describe, expect, it } from 'vitest';
import { nextFrameIndex, safeFrameIndex } from '../src/renderer/src/pet-sprite';

describe('sprite 帧索引', () => {
  it('safeFrameIndex 越界钳到 0', () => {
    expect(safeFrameIndex(99, 11)).toBe(0);
    expect(safeFrameIndex(5, 11)).toBe(5);
    expect(safeFrameIndex(-1, 11)).toBe(0);
  });

  it('nextFrameIndex 按步推进并循环/停尾', () => {
    // 单步推进
    expect(nextFrameIndex(0, 1, [0, 1], true)).toBe(1);
    // loop 回卷
    expect(nextFrameIndex(1, 1, [0, 1], true)).toBe(0);
    // 非 loop 走完
    expect(nextFrameIndex(0, 1, [0, 1], false)).toBe(1);
    // 非 loop 停在尾
    expect(nextFrameIndex(1, 1, [0, 1], false)).toBe(1);
  });

  it('nextFrameIndex 支持大步数跳进（补帧）', () => {
    // 长间隔（如后台标签回来）直接跳进到目标帧
    expect(nextFrameIndex(0, 3, [2, 3, 4, 5], true)).toBe(3);
    // loop 大步数回卷
    expect(nextFrameIndex(0, 4, [0, 1], true)).toBe(0);
    // 非 loop 大步数钳到最后一帧
    expect(nextFrameIndex(0, 9, [8, 9], false)).toBe(1);
  });
});
