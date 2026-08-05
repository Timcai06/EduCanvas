/**
 * 流式转录分段、端点与尾部 flush 纯策略（V06）— 无 I/O 的输入侧状态机。
 *
 * 与 V04/V05 的分工：
 * - `streaming-transcription-contracts.ts` 定义单分片/单事件 Schema；
 * - `streaming-transcription-reducer.ts` 归并 **文本事件**；
 * - 本模块把 **PCM 输入侧**（pushChunk / endpoint / finish / cancel）建模为
 *   纯状态机：只累计字节数与序号，绝不保留 PCM 字节引用（避免无界缓冲），
 *   也不做 VAD、编解码或 recognizer 调用——输出只是应喂给 recognizer 的
 *   描述与状态转换（ADR-0018，V08 Adapter 按描述生成真实 buffer）。
 *
 * ## 生命周期
 *
 * - `open`：可接收分片；endpoint / finish / cancel 均可进入后续状态；
 * - `endpointed`：输入端点已确定，拒绝新分片（`INPUT_AFTER_ENDPOINT`），
 *   但仍允许 finish——尾部 flush 发生在 finish，不在 endpoint；
 * - `finished`：finish 已执行，输出描述含 1.5 秒零值尾部；一切输入动作拒绝；
 * - `cancelled`：取消终态，**不生成**尾部静音；一切输入动作拒绝。
 *
 * ## 不变量
 *
 * - 纯函数：无 I/O、无计时器、无全局可变状态、无供应商/SDK 类型；
 * - 输入（snapshot 与 chunk）绝不被修改，每次动作返回新快照；
 * - 快照只记录 `inputBytes` 与 `sequence`，不持有 `pcmBytes`；
 * - 任意合法 chunk 边界得到相同的输入字节累计与尾部描述（边界等价）；
 * - 相同动作序列总得到深度相等快照（确定性）。
 *
 * ## 拒绝错误码（复用 V04 稳定错误面）
 *
 * | 违规                                             | code                   |
 * | ------------------------------------------------ | ---------------------- |
 * | chunk 的 operationId / segmentId 与快照不匹配    | `UNKNOWN`              |
 * | sequence 重复 / 跳号 / 倒序 / 首事件非 0         | `UNKNOWN`              |
 * | endpointed 后 pushChunk / 重复 endpoint          | `INPUT_AFTER_ENDPOINT` |
 * | finished 后 pushChunk / 重复 finish              | `INPUT_AFTER_FINISH`   |
 * | cancelled 后任何输入动作 / 重复 cancel           | `INPUT_AFTER_TERMINAL` |
 *
 * `UNKNOWN` 用于 V04 没有专门码的结构违规（会话归属、序列结构），是稳定
 * 兜底而非"未知模型失败"；调用方按 code 精确断言。
 */

import {
  MAX_PCM_CHUNK_BYTES,
  STREAMING_TRANSCRIPTION_CHANNELS,
  STREAMING_TRANSCRIPTION_PCM_ENCODING,
  STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
  StreamingTranscriptionStateError,
  type StreamingTranscriptionPcmChunk,
} from './streaming-transcription-contracts';

/**
 * 尾部静音时长（秒）。1.5 秒来自 V01 实测：WASM 流式识别在 inputFinished
 * 前需要尾静音才能 flush 出剩余文本；与冻结的 16 kHz/单声道/PCM16LE 契约
 * 一起决定了尾部字节总数。
 */
export const STREAMING_TRANSCRIPTION_TAIL_SILENCE_SECONDS = 1.5 as const;

/**
 * 尾部静音总字节数 = 1.5 s × 16 000 Hz × 1 声道 × 2 字节/采样 = 48 000。
 * 由采样率/声道/位深推导得出，避免手写魔法数漂移。
 */
export const STREAMING_TRANSCRIPTION_TAIL_SILENCE_BYTES = 48_000 as const;

/** 输入侧阶段：open → endpointed → finished，或任意非终态 → cancelled。 */
export type StreamingSegmentationPhase =
  'open' | 'endpointed' | 'finished' | 'cancelled';

/**
 * 尾部零值 chunk 的**描述**，不是真实 PCM 缓冲：只携带字节数与序号，
 * 由 Adapter（V08）按描述生成真实零值 buffer 喂给 recognizer。
 * `isZero` 恒为 true，防止调用方把生成的静音误当真实采集分片。
 */
export interface StreamingSegmentationTailChunk {
  /** 输出描述序号，从 0 开始连续。 */
  readonly sequence: number;
  /** 本描述覆盖的零值 PCM 字节数；偶数且 ≤ MAX_PCM_CHUNK_BYTES。 */
  readonly byteLength: number;
  /** 16 kHz 单声道 pcm_s16le，与 V04 分片契约一致。 */
  readonly sampleRate: typeof STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ;
  readonly channels: typeof STREAMING_TRANSCRIPTION_CHANNELS;
  readonly encoding: typeof STREAMING_TRANSCRIPTION_PCM_ENCODING;
  /** 恒为 true：这是生成的零值尾部描述，不是采集的 PCM。 */
  readonly isZero: true;
}

/**
 * 单个 operation + segment 会话的不可变输入状态。只承载计数事实，
 * 不包含 PCM 字节、Provider、Prompt、Secret 或 stack。
 */
export interface StreamingSegmentationSnapshot {
  readonly operationId: string;
  readonly segmentId: string;
  readonly phase: StreamingSegmentationPhase;
  /** 已接受的输入 PCM 总字节数（不含尾部）。 */
  readonly inputBytes: number;
  /** 已接受的最大输入 chunk sequence；未收任何分片时为 -1。 */
  readonly sequence: number;
  /** finish 后非空：1.5 秒零值尾部拆分出的合法 chunk 描述序列。 */
  readonly tailChunks: readonly StreamingSegmentationTailChunk[];
  /** 输出总字节数 = inputBytes + 已生成尾部字节（finish 前尾部为 0）。 */
  readonly totalBytes: number;
}

/** 创建空快照。operationId/segmentId 随后所有分片的归属边界：不匹配即拒绝。 */
export function createStreamingSegmentationSnapshot(
  operationId: string,
  segmentId: string,
): StreamingSegmentationSnapshot {
  return {
    operationId,
    segmentId,
    phase: 'open',
    inputBytes: 0,
    sequence: -1,
    tailChunks: [],
    totalBytes: 0,
  };
}

/**
 * 累计一个已通过 V04 Schema 校验的 PCM 分片，返回新快照。
 * 分片的 `pcmBytes` 只读取长度、不保留引用；sequence 必须从 0 严格递增。
 */
export function applyStreamingTranscriptionChunk(
  snapshot: StreamingSegmentationSnapshot,
  chunk: StreamingTranscriptionPcmChunk,
): StreamingSegmentationSnapshot {
  if (chunk.operationId !== snapshot.operationId) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }
  if (chunk.segmentId !== snapshot.segmentId) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }
  if (snapshot.phase === 'endpointed') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_ENDPOINT');
  }
  if (snapshot.phase === 'finished') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
  }
  if (snapshot.phase === 'cancelled') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
  }
  if (chunk.sequence !== snapshot.sequence + 1) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }
  const nextInputBytes = snapshot.inputBytes + chunk.pcmBytes.length;
  return {
    ...snapshot,
    inputBytes: nextInputBytes,
    sequence: chunk.sequence,
    totalBytes: nextInputBytes,
  };
}

/**
 * 声明输入端点已确定：之后拒绝新分片（`INPUT_AFTER_ENDPOINT`）。
 * endpoint 不是终态——最终文本尚未交付，finish 仍会补尾部静音。
 */
export function applyStreamingTranscriptionEndpoint(
  snapshot: StreamingSegmentationSnapshot,
): StreamingSegmentationSnapshot {
  if (snapshot.phase === 'endpointed') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_ENDPOINT');
  }
  if (snapshot.phase === 'finished') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
  }
  if (snapshot.phase === 'cancelled') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
  }
  return { ...snapshot, phase: 'endpointed' };
}

/**
 * 声明输入结束：生成 1.5 秒零值尾部描述并进入 finished 终态。
 * 只能执行一次；重复 finish 抛 `INPUT_AFTER_FINISH`（稳定错误）。
 */
export function applyStreamingTranscriptionFinish(
  snapshot: StreamingSegmentationSnapshot,
): StreamingSegmentationSnapshot {
  if (snapshot.phase === 'finished') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
  }
  if (snapshot.phase === 'cancelled') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
  }
  const tailChunks = buildTailChunks();
  return {
    ...snapshot,
    phase: 'finished',
    tailChunks,
    totalBytes:
      snapshot.inputBytes + STREAMING_TRANSCRIPTION_TAIL_SILENCE_BYTES,
  };
}

/**
 * 取消会话：进入 cancelled 终态且**不生成**尾部静音。
 * 已处于终态（finished/cancelled）时重复 cancel 抛 `INPUT_AFTER_TERMINAL`。
 */
export function applyStreamingTranscriptionCancel(
  snapshot: StreamingSegmentationSnapshot,
): StreamingSegmentationSnapshot {
  if (snapshot.phase === 'finished' || snapshot.phase === 'cancelled') {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
  }
  return { ...snapshot, phase: 'cancelled' };
}

/**
 * 把 48 000 字节零值尾部按单 chunk 32 000 上限拆成合法描述序列
 * （[32 000, 16 000]）。拆分只依赖尾部总字节与单分片上限，与输入边界
 * 无关，因此任意 chunk 边界 finish 后得到相同的尾部描述（边界等价）。
 */
function buildTailChunks(): readonly StreamingSegmentationTailChunk[] {
  const chunks: StreamingSegmentationTailChunk[] = [];
  let remaining = STREAMING_TRANSCRIPTION_TAIL_SILENCE_BYTES;
  let sequence = 0;
  while (remaining > 0) {
    const byteLength = Math.min(remaining, MAX_PCM_CHUNK_BYTES);
    chunks.push({
      sequence,
      byteLength,
      sampleRate: STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
      channels: STREAMING_TRANSCRIPTION_CHANNELS,
      encoding: STREAMING_TRANSCRIPTION_PCM_ENCODING,
      isZero: true,
    });
    remaining -= byteLength;
    sequence += 1;
  }
  return chunks;
}
