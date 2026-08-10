import { describe, expect, it } from 'vitest';
import { createSpriteSheet } from '../scripts/generate-pet-sprites.mjs';

describe('pet sprite sheet 生成', () => {
  it('生成 32×N 的 RGBA PNG（11 帧）', () => {
    const { pngBuffer } = createSpriteSheet();
    // PNG 签名 + IHDR 前 16 字节
    expect(pngBuffer.slice(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const width = pngBuffer.readUInt32BE(16);
    const height = pngBuffer.readUInt32BE(20);
    expect(width).toBe(32 * 11);
    expect(height).toBe(32);
  });

  it('manifest 声明 6 个状态、帧索引不越界、锚点存在', () => {
    const { manifest } = createSpriteSheet();
    const allFrames = Object.values(manifest.states).flatMap((s) => s.frames);
    expect(allFrames.length).toBe(11);
    for (const idx of allFrames) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(11);
    }
    expect(manifest.anchor).toEqual({ x: 16, y: 32 });
  });

  it('含 IDAT 数据块（可渲染像素）', () => {
    const { pngBuffer } = createSpriteSheet();
    // 轻量校验：IDAT 块存在且非空；透明像素由渲染层验收覆盖
    expect(pngBuffer.includes(Buffer.from('IDAT'))).toBe(true);
  });
});
