/**
 * 音频双向传输 envelope（V07）— transport-neutral 消息契约（ADR-0018）。
 *
 * 与 V04/V05 的分工：
 * - V04 contracts 定义 PCM 分片与领域事件契约，是 Provider 不可信输入的
 *   校验边界；
 * - V05 reducer 做增量归并；
 * - 本模块定义浏览器 ↔ 网关之间的 client/server 消息 envelope，只做 schema
 *   与纯序列验证，**不实现任何 I/O**（不实现 WebSocket，V12 才接线真实
 *   传输层）。
 *
 * ## 纪律
 *
 * - 每条消息都携带固定 `protocolVersion`/`operationId`/`segmentId`/`sequence`，
 *   便于跨消息校验与审计；
 * - `start` 只携带受控音频格式（16 kHz / mono / pcm_s16le，与 V04 常量
 *   一致），不携带身份、Notebook、Provider、模型路径或 Secret；
 *   `.strict()` 拒绝一切额外键，堵住注入与泄露通道；
 * - `chunk` 复用 V04 的 `MAX_PCM_CHUNK_BYTES` 上限与格式约束，只接受
 *   `Uint8Array` PCM 字节，不接受 URL、文件路径或 Base64 data URL；
 * - server 消息直接复用 V04 事件 schema（partial/endpoint/final/failed），
 *   失败面只有稳定 `failureCode`，不新增自由错误 message 字段；
 * - client 流的唯一终态动作是 `finish`（正常结束）或 `cancel`（放弃），
 *   二者互斥且至多一次、之后不再有任何消息；server 流的唯一终态是
 *   `final` 或 `failed`（V04 纪律）。cancel 在 server 侧映射为
 *   `failed` + `CANCELLED`，因此整个会话至多收敛到一个终态。
 *
 * 本文件只描述消息结构与跨消息纯验证，不含任何全局可变状态或 reducer；
 * 会话状态推进属于 V05/V08，不在这里实现。
 */

import { z } from 'zod';
import {
  MAX_PCM_CHUNK_BYTES,
  STREAMING_TRANSCRIPTION_CHANNELS,
  STREAMING_TRANSCRIPTION_PCM_ENCODING,
  STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
  streamingTranscriptionEventSchema,
  streamingTranscriptionProtocolVersion,
  validateStreamingTranscriptionEventSequence,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionPcmChunk,
} from './streaming-transcription-contracts';

/**
 * V04 未导出其内部 id/sequence schema，V07 按独立文件边界复制同一约束
 * （opaque id 1–256 字符、sequence 为非负安全整数），保证 client 消息与
 * V04 分片/事件的身份字段约束一致；若 V04 调整约束，两处需同步。
 */
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

/** 受控音频格式三件套：只允许 V04 冻结的 16 kHz / mono / pcm_s16le。 */
const audioFormatFields = {
  sampleRate: z.literal(STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ),
  channels: z.literal(STREAMING_TRANSCRIPTION_CHANNELS),
  encoding: z.literal(STREAMING_TRANSCRIPTION_PCM_ENCODING),
} as const;

/** 单分片 PCM 字节约束，与 V04 `streamingTranscriptionPcmChunkSchema` 相同。 */
const pcmBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.length > 0, 'PCM 字节不能为空')
  .refine(
    (bytes) => bytes.length % 2 === 0,
    'PCM 字节数必须为偶数（16-bit 采样）',
  )
  .refine((bytes) => bytes.length <= MAX_PCM_CHUNK_BYTES, '超过单分片字节上限');

/** client 消息公共字段：固定 protocolVersion 与会话/消息身份。 */
const clientMessageBase = {
  protocolVersion: z.literal(streamingTranscriptionProtocolVersion),
  operationId: opaqueIdSchema,
  segmentId: opaqueIdSchema,
  sequence: safeNonNegativeIntegerSchema,
};

/**
 * client → server 消息（discriminated union）：
 * - start：会话首条消息，只携带受控音频格式，sequence 固定为 0；
 * - chunk：PCM 分片，复用 V04 字节上限，不接受任何外部引用；
 * - finish：声明输入结束，等待最终结果；
 * - cancel：放弃会话，server 侧收敛为 failed + CANCELLED。
 */
export const streamingTranscriptionClientMessageSchema = z.discriminatedUnion(
  'type',
  [
    z
      .object({
        ...clientMessageBase,
        type: z.literal('start'),
        // 会话起始消息序号固定为 0：start 必须是流的第一条且只出现一次。
        sequence: z.literal(0),
        ...audioFormatFields,
      })
      .strict(),
    z
      .object({
        ...clientMessageBase,
        type: z.literal('chunk'),
        /** PCM 分片自己的连续序号，从 0 开始；与 envelope sequence 分域。 */
        chunkSequence: safeNonNegativeIntegerSchema,
        ...audioFormatFields,
        pcmBytes: pcmBytesSchema,
      })
      .strict(),
    z
      .object({
        ...clientMessageBase,
        type: z.literal('finish'),
      })
      .strict(),
    z
      .object({
        ...clientMessageBase,
        type: z.literal('cancel'),
      })
      .strict(),
  ],
);

export type StreamingTranscriptionClientMessage = z.infer<
  typeof streamingTranscriptionClientMessageSchema
>;

export type StreamingTranscriptionClientMessageType =
  StreamingTranscriptionClientMessage['type'];

type StreamingTranscriptionChunkMessage = Extract<
  StreamingTranscriptionClientMessage,
  { type: 'chunk' }
>;

/**
 * 把传输层 chunk 显式投影为 V04 PCM 分片。message sequence 包含 start 等
 * 控制消息，不能直接冒充分片序号；V08 必须通过本函数取得 chunkSequence。
 */
export function toStreamingTranscriptionPcmChunk(
  message: StreamingTranscriptionChunkMessage,
): StreamingTranscriptionPcmChunk {
  return {
    operationId: message.operationId,
    segmentId: message.segmentId,
    sequence: message.chunkSequence,
    sampleRate: message.sampleRate,
    channels: message.channels,
    encoding: message.encoding,
    pcmBytes: message.pcmBytes,
  };
}

/**
 * server → client 消息：直接复用 V04 事件 schema
 * （partial/endpoint/final/failed），不新增自由错误 message 字段，
 * 失败面只有稳定 failureCode。
 */
export const streamingTranscriptionServerMessageSchema =
  streamingTranscriptionEventSchema;

export type StreamingTranscriptionServerMessage = StreamingTranscriptionEvent;

/**
 * 跨消息纯验证器（无状态）。校验单个 client 消息流：
 *
 * - 首条必须是 start，且 start 至多一次（重复 start 拒绝）；
 * - 所有消息必须属于同一 operationId 与 segmentId；
 * - sequence 必须从 0 严格连续递增（乱序、跳号、重复都被拒绝）；
 * - finish/cancel 是唯一终态动作：至多一次、二者互斥、其后不允许任何消息
 *   （finish/cancel 后 chunk、重复 finish/cancel、finish 后 cancel 都拒绝）。
 *
 * 空数组视为合法（尚未开始会话）。本函数只校验消息序列结构，内容由
 * Schema 保证；server 侧序列校验复用 V04
 * `validateStreamingTranscriptionEventSequence`（final/failed 唯一终态）。
 */
export function validateStreamingTranscriptionClientMessageSequence(
  messages: readonly StreamingTranscriptionClientMessage[],
): boolean {
  if (messages.length === 0) return true;
  const first = messages[0]!;
  if (first.type !== 'start') return false;
  let terminalActionSeen = false;
  let expectedChunkSequence = 0;
  for (let index = 0; index < messages.length; index += 1) {
    // 循环边界保证索引不越界，noUncheckedIndexedAccess 下的访问是安全的。
    const message = messages[index]!;
    if (message.operationId !== first.operationId) return false;
    if (message.segmentId !== first.segmentId) return false;
    if (message.sequence !== index) return false;
    // 终态动作后任何消息（chunk/finish/cancel）一律拒绝。
    if (terminalActionSeen) return false;
    if (message.type === 'start' && index !== 0) return false;
    if (message.type === 'chunk') {
      if (message.chunkSequence !== expectedChunkSequence) return false;
      expectedChunkSequence += 1;
    }
    if (message.type === 'finish' || message.type === 'cancel') {
      terminalActionSeen = true;
    }
  }
  return true;
}

/** server 消息序列校验：复用 V04 单 segment 事件序列纪律。 */
export const validateStreamingTranscriptionServerMessageSequence =
  validateStreamingTranscriptionEventSequence;
