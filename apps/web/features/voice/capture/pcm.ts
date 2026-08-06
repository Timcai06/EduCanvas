/**
 * PCM 编码与声道归并纯函数（V16）。
 *
 * 转换规则是确定性契约（测试固定断言边界值）：
 * - Float32 采样先裁剪到 [-1, 1]（越界值不产生 int16 回绕）；
 * - 乘以 32768 取整后再裁剪到 int16 范围 [-32768, 32767]，与 ffmpeg
 *   pcm_s16le 的映射一致：-1.0 → -32768，+1.0 → +32767，覆盖 int16
 *   全量程；
 * - 输出 little-endian 字节序（s16le 的 "le"）。
 */

/**
 * Float32 采样数组 → pcm_s16le 字节（little-endian）。
 * 返回新建的 Uint8Array，调用方持有后修改不影响内部状态。
 */
export function float32ToPcm16Le(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    const rounded = Math.round(clamped * 32768);
    const value = Math.max(-32768, Math.min(32767, rounded));
    // 二进制补码 + little-endian：直接取低 16 位按低字节在前写出。
    const bits = value & 0xffff;
    out[i * 2] = bits & 0xff;
    out[i * 2 + 1] = (bits >> 8) & 0xff;
  }
  return out;
}

/**
 * 多声道 → mono 归并：逐样本取所有声道平均。
 *
 * 平均不引入相位差信息损失且结果必然落在 [-1, 1]（各声道都在该范围），
 * 不会产生新的裁剪；单声道输入返回独立拷贝，避免调用方持有引用后改写
 * 影响采集器内部缓冲（音频块所有权安全边界）。
 */
export function mixChannelsToMono(
  channels: readonly Float32Array[],
): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const first = channels[0]!;
  if (channels.length === 1) return first.slice();
  const length = first.length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels.length; c += 1) {
      sum += channels[c]![i]!;
    }
    out[i] = sum / channels.length;
  }
  return out;
}
