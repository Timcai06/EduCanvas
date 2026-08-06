import { describe, expect, it } from 'vitest';
import { createLinearResampler } from './resampler';

/** 把数字数组转成 Float32Array 便于输入构造。 */
function f32(values: readonly number[]): Float32Array {
  return Float32Array.from(values);
}

describe('createLinearResampler 参数校验', () => {
  it('拒绝非正或非整数采样率', () => {
    expect(() => createLinearResampler(0, 16000)).toThrow(RangeError);
    expect(() => createLinearResampler(16000, 0)).toThrow(RangeError);
    expect(() => createLinearResampler(44100.5, 16000)).toThrow(RangeError);
    expect(() => createLinearResampler(16000, 16000.5)).toThrow(RangeError);
  });

  it('接受合法采样率', () => {
    expect(() => createLinearResampler(16000, 16000)).not.toThrow();
  });
});

describe('16k 输入直通（V16 必测）', () => {
  it('push 延迟一个样本，finish 补齐后逐样本还原', () => {
    const r = createLinearResampler(16000, 16000);
    const out = r.push(f32([1, 2, 3, 4]));
    // 窗口 [i-1, i] 内生成输出：i=1..3 各生成一个（延迟 1 个样本）。
    expect(Array.from(out)).toEqual([1, 2, 3]);
    const tail = r.finish();
    expect(Array.from(tail)).toEqual([4]);
  });

  it('分块处理与一次处理结果相同（分块等价）', () => {
    const oneShot = createLinearResampler(16000, 16000);
    const all = oneShot.push(f32([1, 2, 3, 4, 5]));
    const tailAll = oneShot.finish();

    const chunked = createLinearResampler(16000, 16000);
    const parts = [
      chunked.push(f32([1])),
      chunked.push(f32([2, 3])),
      chunked.push(f32([4, 5])),
    ];
    const tailParts = chunked.finish();

    const a = [...Array.from(all), ...Array.from(tailAll)];
    const b = [
      ...parts.flatMap((p) => Array.from(p)),
      ...Array.from(tailParts),
    ];
    expect(a).toEqual(b);
  });
});

describe('44.1k → 16k（V16 必测）', () => {
  it('按 t_j = j*44100/16000 线性插值', () => {
    const r = createLinearResampler(44100, 16000);
    // 4 个输入样本 → 期望 2 个输出：j=0 → x0；j=1 → t=2.75625 → 窗口 [2,3] frac=0.75625。
    const out = r.push(f32([0, 1, 2, 3]));
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(2 + 1 * 0.75625, 6);
    // 输入耗尽，无额外冲刷输出。
    expect(Array.from(r.finish())).toEqual([]);
  });

  it('确定性：相同输入两次运行逐样本相等', () => {
    const input = f32(Array.from({ length: 97 }, (_, i) => Math.sin(i / 7)));
    const a = createLinearResampler(44100, 16000).push(input);
    const b = createLinearResampler(44100, 16000).push(input);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('48k → 16k（V16 必测）', () => {
  it('整数倍降采样：每 3 个输入样本取窗口起点样本', () => {
    const r = createLinearResampler(48000, 16000);
    const out = r.push(f32([1, 2, 3, 4, 5, 6]));
    expect(Array.from(out)).toEqual([1, 4]);
    expect(Array.from(r.finish())).toEqual([]);
  });
});

describe('8k → 16k（升采样）', () => {
  it('每输入样本生成 2 个输出：线性插值 + 尾部零阶保持', () => {
    const r = createLinearResampler(8000, 16000);
    const out = r.push(f32([0, 1000]));
    expect(Array.from(out)).toEqual([0, 500]);
    // finish 冲刷剩余输出位置（t=2,3 超出已知窗口 → 零阶保持 1000）。
    expect(Array.from(r.finish())).toEqual([1000, 1000]);
  });
});

describe('跨块连续性', () => {
  it('单样本分块下重采样结果与整块一致（边界窗口正确）', () => {
    const input = f32([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const oneShot = createLinearResampler(44100, 16000);
    const all = [
      ...Array.from(oneShot.push(input)),
      ...Array.from(oneShot.finish()),
    ];

    const chunked = createLinearResampler(44100, 16000);
    const parts: number[] = [];
    for (const v of input) {
      parts.push(...Array.from(chunked.push(f32([v]))));
    }
    parts.push(...Array.from(chunked.finish()));
    expect(parts).toEqual(all);
  });
});
