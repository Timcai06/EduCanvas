/**
 * 浏览器音频采集的稳定失败码与错误类型（V16）。
 *
 * 与 V04 转录 failureCode 分域：本文件描述"采集侧"错误（拿不到麦克风、
 * AudioContext 起不来、消费者抛错），V04/V07 描述"会话侧"错误。两者都
 * 遵守同一纪律——错误面只暴露稳定码，绝不携带浏览器原始异常、设备名、
 * 采样率细节或堆栈（CLAUDE.md 的"不暴露 Provider/浏览器内部"要求）。
 */

/** 采集侧稳定失败码；错误面只允许这些码。 */
export const audioCaptureFailureCodes = [
  /** getUserMedia 被用户拒绝（NotAllowedError 族）。 */
  'PERMISSION_DENIED',
  /** 系统没有可用输入设备（NotFoundError 族）。 */
  'NO_AUDIO_INPUT',
  /** AudioContext 创建或 resume 失败。 */
  'AUDIO_CONTEXT_FAILED',
  /** 其他采集侧失败（getUserMedia 的其他浏览器错误）。 */
  'CAPTURE_FAILED',
  /** chunk consumer 抛错；采集立即终止并清理。 */
  'CONSUMER_FAILED',
  /** 非法状态转换（例如已结束后再次 start）。 */
  'INVALID_STATE',
  /** 构造参数非法（chunkBytes 越界等）。 */
  'INVALID_OPTIONS',
] as const;

export type AudioCaptureFailureCode = (typeof audioCaptureFailureCodes)[number];

/**
 * 采集错误：message 与 code 保持一致，避免浏览器原始异常文本通过
 * 可选 message 带出领域边界（与 agent-core 的
 * `StreamingTranscriptionStateError` 同一策略）。
 */
export class AudioCaptureError extends Error {
  override readonly name = 'AudioCaptureError';

  constructor(readonly code: AudioCaptureFailureCode) {
    super(code);
  }
}
