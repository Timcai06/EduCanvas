import { describe, expect, it } from 'vitest';
import { float32ToPcm16Le, mixChannelsToMono } from './pcm';

describe('float32ToPcm16Le 边界值与裁剪（V16 必测）', () => {
  it('±1.0 映射到 int16 全量程边界', () => {
    const bytes = float32ToPcm16Le(Float32Array.from([-1, 1]));
    // -32768 LE = [0x00, 0x80]；+32767 LE = [0xFF, 0x7F]
    expect(Array.from(bytes)).toEqual([0x00, 0x80, 0xff, 0x7f]);
  });

  it('超出 [-1, 1] 的输入被裁剪而不是回绕', () => {
    const bytes = float32ToPcm16Le(Float32Array.from([-2, 2, 1.5, -1.5]));
    expect(Array.from(bytes)).toEqual([
      0x00,
      0x80, // -2 → -32768
      0xff,
      0x7f, //  2 → +32767
      0xff,
      0x7f, //  1.5 → +32767
      0x00,
      0x80, // -1.5 → -32768
    ]);
  });

  it('中间值按 ×32768 取整（0.5 → 16384）', () => {
    const bytes = float32ToPcm16Le(Float32Array.from([0.5]));
    expect(Array.from(bytes)).toEqual([0x00, 0x40]); // 16384 LE
  });

  it('静音为全零且字节数为样本数×2（偶数）', () => {
    const bytes = float32ToPcm16Le(new Float32Array(100));
    expect(bytes.length).toBe(200);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it('返回独立拷贝：修改结果不影响后续调用', () => {
    const first = float32ToPcm16Le(Float32Array.from([0.25]));
    first[0] = 0xff;
    const second = float32ToPcm16Le(Float32Array.from([0.25]));
    expect(second[0]).toBe(0x00);
  });
});

describe('mixChannelsToMono 双声道归并（V16 必测）', () => {
  it('双声道逐样本平均', () => {
    const mono = mixChannelsToMono([
      Float32Array.from([0.2, -0.4, 0.6]),
      Float32Array.from([0.4, 0.0, 0.6]),
    ]);
    // Float32 存储有精度损失，用 closeTo 断言。
    expect(mono[0]).toBeCloseTo(0.3, 6);
    expect(mono[1]).toBeCloseTo(-0.2, 6);
    expect(mono[2]).toBeCloseTo(0.6, 6);
  });

  it('双声道平均结果必然在 [-1, 1] 内（不产生新裁剪）', () => {
    const mono = mixChannelsToMono([
      Float32Array.from([0.9, 1]),
      Float32Array.from([0.9, 1]),
    ]);
    expect(mono[0]).toBeCloseTo(0.9, 6);
    expect(mono[1]).toBeCloseTo(1, 6);
  });

  it('单声道输入返回独立拷贝（所有权安全）', () => {
    const source = Float32Array.from([0.1, 0.2]);
    const mono = mixChannelsToMono([source]);
    mono[0] = 0.9;
    expect(source[0]).toBeCloseTo(0.1, 6);
  });

  it('空输入返回空数组', () => {
    expect(mixChannelsToMono([]).length).toBe(0);
  });
});
