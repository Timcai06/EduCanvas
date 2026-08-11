/**
 * 流式转录领域契约（ADR-0018 的 Port 边界）。
 *
 * ## 边界
 *
 * - PCM 分片与转录事件是传输层与 Provider 适配器都不可信的外部输入，
 *   必须经过本文件 Schema 校验后才能产生领域事件（CLAUDE.md 的 Provider
 *   输入一律视为不可信要求）。
 * - 本文件只描述单消息结构与跨消息纯验证器，不含任何 I/O、全局可变状态
 *   或 reducer；分片累积、端点判定与增量合并属于 V05，不在这里实现。
 * - 每个事件都不携带 Secret、PCM 字节、Prompt、模型路径、Provider 原始
 *   body 或 stack：failed 事件只暴露稳定 failureCode。
 *
 * ## 生命周期语义（单 segment 会话）
 *
 * - partial：同一 segment 的可修正假设，可被后续 partial/final 覆盖；
 * - endpoint：输入端点已确定 —— 输入侧关闭、不再产生新的 partial，
 *   但最终文本（final）尚未交付，因此 endpoint 不是终态；
 * - final：同一 segment 的不可回退文本，唯一成功终态；
 * - failed：稳定失败码，唯一失败终态。
 *
 * 终态只有 final/failed，避免 endpoint 与 final 同时宣称"最终结果"造成的
 * 重复终态。取消以 failed + CANCELLED 表达，仍满足唯一终态纪律。
 */

import { z } from 'zod';

/** 流式转录协议版本；所有 PCM 分片与事件都必须声明该版本。 */
export const streamingTranscriptionProtocolVersion =
  'educanvas.streaming-transcription.v1' as const;

/**
 * 采样率冻结为 16 kHz：浏览器采集、Gateway 协议与实时 ASR Provider 均按
 * 16 kHz 接收；放开会让协议参与方无法共用同一输入契约。
 */
export const STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ = 16_000 as const;

/** 声道冻结为单声道：当前交互式转录不做说话人分离，多声道没有消费者。 */
export const STREAMING_TRANSCRIPTION_CHANNELS = 1 as const;

/** PCM 编码冻结为 signed 16-bit little-endian：实时 ASR Provider 的输入契约。 */
export const STREAMING_TRANSCRIPTION_PCM_ENCODING = 'pcm_s16le' as const;

/**
 * 单分片字节上限 = 16 kHz × 1 声道 × 2 字节 × 1 秒 = 32 000。
 * 上限由采样率、声道与位深决定，不允许调用方传入更大块；1 秒粒度足够
 * 覆盖 100 ms–1 s 的浏览器采集分块（V01 实测 100 ms 分块）。
 */
export const MAX_PCM_CHUNK_BYTES = 32_000 as const;

/**
 * 单次 partial/final 文本上限。交互式实时输入场景下，一次假设/终稿
 * 超过 1 000 字符视为异常（可能是 Provider 把长段音频当成一句），
 * 拒绝而不是无界接收。
 */
export const MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH = 1_000 as const;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine((value) => Number.isSafeInteger(value), 'sequence 必须是安全整数');

/**
 * 单个 PCM 分片。业务侧只允许携带分片字节与其身份，不接受音频路径、
 * Base64 URL、模型路径、Provider 类型或任何身份字段（`.strict()` 拒绝
 * 额外键）；这些信息若被 Provider 接受会成为注入或泄露通道。
 */
export const streamingTranscriptionPcmChunkSchema = z
  .object({
    operationId: opaqueIdSchema,
    segmentId: opaqueIdSchema,
    /** 会话内严格递增的事件/分片序号，从 0 开始。 */
    sequence: safeNonNegativeIntegerSchema,
    sampleRate: z.literal(STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ),
    channels: z.literal(STREAMING_TRANSCRIPTION_CHANNELS),
    encoding: z.literal(STREAMING_TRANSCRIPTION_PCM_ENCODING),
    pcmBytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.length > 0, 'PCM 字节不能为空')
      .refine(
        (bytes) => bytes.length % 2 === 0,
        'PCM 字节数必须为偶数（16-bit 采样）',
      )
      .refine(
        (bytes) => bytes.length <= MAX_PCM_CHUNK_BYTES,
        '超过单分片字节上限',
      ),
  })
  .strict();

export type StreamingTranscriptionPcmChunk = z.infer<
  typeof streamingTranscriptionPcmChunkSchema
>;

/** 稳定失败码；错误面只允许这些码，不得携带 Provider 消息、响应体或堆栈。 */
export const streamingTranscriptionFailureCodes = [
  'INVALID_PCM_CHUNK',
  'INPUT_AFTER_FINISH',
  'INPUT_AFTER_ENDPOINT',
  'INPUT_AFTER_TERMINAL',
  'MODEL_FAILED',
  'CANCELLED',
  'UNKNOWN',
] as const;

export const streamingTranscriptionFailureCodeSchema = z.enum(
  streamingTranscriptionFailureCodes,
);
export type StreamingTranscriptionFailureCode = z.infer<
  typeof streamingTranscriptionFailureCodeSchema
>;

const eventBase = {
  protocolVersion: z.literal(streamingTranscriptionProtocolVersion),
  operationId: opaqueIdSchema,
  segmentId: opaqueIdSchema,
  sequence: safeNonNegativeIntegerSchema,
};

const transcriptionTextSchema = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, '转录文本不能只包含空白')
  .max(MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH);

/**
 * 流式转录事件。使用 discriminated union，每个事件都携带
 * protocolVersion/operationId/segmentId/sequence，便于跨消息校验与审计。
 */
export const streamingTranscriptionEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...eventBase,
      type: z.literal('partial'),
      text: transcriptionTextSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('endpoint'),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('final'),
      text: transcriptionTextSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('failed'),
      failureCode: streamingTranscriptionFailureCodeSchema,
    })
    .strict(),
]);

export type StreamingTranscriptionEvent = z.infer<
  typeof streamingTranscriptionEventSchema
>;

/** 终态判定：final（成功）与 failed（失败）是仅有的两个终态。 */
export function isStreamingTranscriptionTerminalEvent(
  event: StreamingTranscriptionEvent,
): boolean {
  return event.type === 'final' || event.type === 'failed';
}

/**
 * 跨消息纯验证器（无全局可变状态）。校验单个 segment 的事件流：
 *
 * - 所有事件必须属于同一 operationId 与 segmentId；
 * - sequence 必须严格连续递增，从 0 开始（重复、跳号、负数都被拒绝）；
 * - 终态（final/failed）至多一次且必须是最后一项；
 * - endpoint 至多一次，且其后不允许 partial（端点确定后不再有修正假设）；
 * - endpoint 允许出现在 final/failed 之前。
 *
 * 空数组视为合法（尚未产生任何事件）。本函数只校验消息序列结构，
 * 不产生事件，也不验证事件内容（内容由 Schema 保证）。
 */
export function validateStreamingTranscriptionEventSequence(
  events: readonly StreamingTranscriptionEvent[],
): boolean {
  if (events.length === 0) return true;
  const first = events[0]!;
  let terminalSeen = false;
  let endpointSeen = false;
  for (let index = 0; index < events.length; index += 1) {
    // 循环边界保证索引不越界，noUncheckedIndexedAccess 下的访问是安全的。
    const event = events[index]!;
    if (event.operationId !== first.operationId) return false;
    if (event.segmentId !== first.segmentId) return false;
    if (event.sequence !== index) return false;
    if (terminalSeen) return false;
    if (endpointSeen && event.type === 'partial') return false;
    if (event.type === 'endpoint') {
      if (endpointSeen) return false;
      endpointSeen = true;
    }
    terminalSeen = isStreamingTranscriptionTerminalEvent(event);
  }
  return true;
}

/**
 * 会话实现拒绝非法输入动作时抛出的稳定错误：只暴露 failureCode，
 * 不携带 Provider 细节或内部状态。
 */
export class StreamingTranscriptionStateError extends Error {
  override readonly name = 'StreamingTranscriptionStateError';

  constructor(readonly code: StreamingTranscriptionFailureCode) {
    // 公共错误的 message 与 code 保持一致，避免适配器把 Provider 消息或
    // 内部状态通过可选 message 带出领域边界。
    super(code);
  }
}
