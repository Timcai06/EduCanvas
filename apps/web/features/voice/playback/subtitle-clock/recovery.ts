export interface SubtitleDurationClock {
  /** 根据历史样本返回估算时长的缩放比例（>=0.6, <=1.8）。 */
  getScaleFactor(): number;
  /** 用真实累计 PCM 时长来更新下一次缩放。 */
  observe(actualSeconds: number, estimatedSeconds: number): void;
  /** 重置会话状态。 */
  reset(): void;
}

interface SubtitleDurationClockOptions {
  readonly minScale?: number;
  readonly maxScale?: number;
}

export function createSubtitleDurationClock(
  options: SubtitleDurationClockOptions = {},
): SubtitleDurationClock {
  const minScale = options.minScale ?? 0.6;
  const maxScale = options.maxScale ?? 1.8;
  let totalEstimated = 0;
  let totalActual = 0;

  const clamp = (value: number): number => {
    if (!Number.isFinite(value) || value <= 0) return 1;
    if (value < minScale) return minScale;
    if (value > maxScale) return maxScale;
    return value;
  };

  return {
    getScaleFactor: () => {
      if (totalEstimated <= 0 || totalActual <= 0) return 1;
      return clamp(totalActual / totalEstimated);
    },
    observe: (actualSeconds, estimatedSeconds) => {
      if (actualSeconds <= 0 || estimatedSeconds <= 0) return;
      totalActual += actualSeconds;
      totalEstimated += estimatedSeconds;
    },
    reset: () => {
      totalEstimated = 0;
      totalActual = 0;
    },
  };
}
