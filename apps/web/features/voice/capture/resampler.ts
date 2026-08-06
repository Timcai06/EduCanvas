/**
 * 确定性线性插值重采样器（V16）。
 *
 * 把任意输入采样率的 mono Float32 流转换为 16 kHz 输出流。实现是"输入
 * 驱动 + 整数边界判定"的线性插值：
 *
 * - 输出样本 j 在输入域的理想位置是 `t_j = j * inputRate / outputRate`；
 * - 对每个输入样本 i，其与上一个样本的窗口 `[i-1, i]` 内所有输出样本
 *   用 `left + (right - left) * frac` 插值生成；
 * - 窗口归属用整数比较 `j * inputRate` 与 `i * outputRate` 判定，避免
 *   浮点相位累积误差导致的分块边界抖动——相同输入序列永远得到相同输出
 *   （确定性，测试以"同输入两次运行结果逐样本相等"验证）；
 * - 跨块状态只有三个整数/单值：`nextOutputIndex`、`consumedInput`、
 *   `previousSample`，因此分块方式不影响最终 PCM 描述（等价于一次处理
 *   全部输入，V06 的分块等价纪律）。
 *
 * 边界语义：
 * - 首样本前视输入为静音 0，因此流开头的输出可能从 0 开始插值；
 * - 最后一个输入样本之后（finish）剩余输出处于"超出已知窗口"区域，
 *   用零阶保持（重复最后一个样本值），保证 16k 直通恰好逐样本还原；
 * - 不做抗混叠低通：麦克风通常已硬件带限，且本工具面向 K12 语音短句，
 *   若需要更高重采样质量需先经 ADR 决策（残余风险见 V16 报告）。
 *
 * 整数乘法规模：`nextOutputIndex * inputRate` 每秒约 7.7e8（16k 输出 ×
 * 48k 输入），远低于 Number.MAX_SAFE_INTEGER（~9e15），小时级会话安全。
 */

/** 每个输出样本在输入域的推进步长 = inputRate / outputRate。 */
export interface LinearResampler {
  /**
   * 消费一块输入样本，返回新生成的输出样本。块大小任意；跨块状态
   * （相位与边界样本）在实例内部持续，因此分块不影响结果。
   */
  push(samples: Float32Array): Float32Array;
  /**
   * 输入流结束：冲刷剩余的零阶保持输出。调用后实例不再接受输入
   * （行为未定义，调用方应丢弃实例）。
   */
  finish(): Float32Array;
}

/**
 * 创建重采样器。两个采样率都必须是正整数；非法输入抛 RangeError，
 * 由调用方（audio-capture）映射为稳定错误码。
 */
export function createLinearResampler(
  inputRate: number,
  outputRate: number,
): LinearResampler {
  if (!Number.isInteger(inputRate) || inputRate <= 0) {
    throw new RangeError('inputRate 必须是正整数');
  }
  if (!Number.isInteger(outputRate) || outputRate <= 0) {
    throw new RangeError('outputRate 必须是正整数');
  }

  /** 下一个待生成的输出样本序号（全局，跨块持续）。 */
  let nextOutputIndex = 0;
  /** 已消费的输入样本总数（下一块的起始全局位置）。 */
  let consumedInput = 0;
  /** 上一个输入样本值；流开始前视为 0（静音）。 */
  let previousSample = 0;

  function push(samples: Float32Array): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < samples.length; i += 1) {
      const x = samples[i]!;
      // 当前输入样本的全局位置 p；已知窗口 [p-1, p]，两端值 previousSample/x。
      const windowRight = consumedInput + i;
      const windowLeft = windowRight - 1;
      // 生成窗口内所有输出 j：j*inputRate ∈ [(p-1)*outputRate, p*outputRate)。
      while (nextOutputIndex * inputRate < windowRight * outputRate) {
        const numerator = nextOutputIndex * inputRate;
        if (numerator >= windowLeft * outputRate) {
          const frac = (numerator - windowLeft * outputRate) / outputRate;
          out.push(previousSample + (x - previousSample) * frac);
        }
        nextOutputIndex += 1;
      }
      previousSample = x;
    }
    consumedInput += samples.length;
    return Float32Array.from(out);
  }

  function finish(): Float32Array {
    const out: number[] = [];
    const total = consumedInput;
    // 剩余输出 j 满足 t_j < total，且 t_j >= total - 1（超出最后已知窗口），
    // 全部用零阶保持（最后一个输入样本值）。
    while (nextOutputIndex * inputRate < total * outputRate) {
      out.push(previousSample);
      nextOutputIndex += 1;
    }
    return Float32Array.from(out);
  }

  return { push, finish };
}
