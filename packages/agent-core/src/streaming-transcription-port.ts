/**
 * 流式转录 Port — 供应商无关的会话边界（ADR-0018）。
 *
 * 与一次性 `AudioTranscriptionModelGateway` 并列：前者服务已上传录音的
 * 异步转录，本 Port 服务实时输入的连续听写。两者产出的文本进入 Prompt
 * 的方式一致，但本 Port 不接收完整音频字节，只接收分片。
 *
 * ## 生命周期
 *
 * 1. `beginStreaming` 启动一个会话（一个 operationId + 一个 segmentId）；
 * 2. `pushChunk` 推送 16 kHz 单声道 PCM s16le 分片；
 * 3. `finish` 声明输入结束，等待最终结果；
 * 4. `cancel` 终止会话，事件流以 `failed` + `CANCELLED` 收尾（唯一终态纪律）；
 * 5. 事件通过 `events` 消费：partial → endpoint → final / failed。
 *
 * ## 纪律
 *
 * - `finish`、endpoint 或终态之后不得再 `pushChunk`，分别抛
 *   INPUT_AFTER_FINISH、INPUT_AFTER_ENDPOINT 或 INPUT_AFTER_TERMINAL；
 * - 公共类型只出现供应商无关的领域形状，不引用 sherpa、onnx、HTTP、
 *   WebSocket、数据库或任何 SDK 类型；
 * - 本文件只定义接口形状，不实现任何真实 I/O（V08 提供 Adapter 实现）。
 */

import type { ModelAbortSignal } from './model-contracts';
import type {
  StreamingTranscriptionEvent,
  StreamingTranscriptionPcmChunk,
} from './streaming-transcription-contracts';

/**
 * 启动流式转录会话的请求。operationId/segmentId 为不透明标识
 * （1–256 字符，见 contracts 的 opaqueId 约束）；不携带模型路径、
 * Provider 类型或身份字段。
 */
export interface StreamingTranscriptionRequest {
  operationId: string;
  segmentId: string;
  traceId: string;
  /** 最小取消契约；不依赖 DOM/Node 的具体 AbortSignal 实现。 */
  signal?: ModelAbortSignal;
}

/**
 * 单个流式转录会话句柄。输入动作（pushChunk/finish/cancel）与事件消费
 * （events）分离：实现方在动作与事件流之间保持终态纪律。
 */
export interface StreamingTranscriptionSession {
  /** 消费转录事件（partial/endpoint/final/failed）。 */
  readonly events: AsyncIterable<StreamingTranscriptionEvent>;
  /**
   * 推送一个已验证的 PCM 分片。finish、endpoint 或终态之后调用抛
   * `StreamingTranscriptionStateError`（INPUT_AFTER_FINISH /
   * INPUT_AFTER_ENDPOINT / INPUT_AFTER_TERMINAL）。
   */
  pushChunk(chunk: StreamingTranscriptionPcmChunk): void;
  /** 声明输入结束；之后不得再 pushChunk。 */
  finish(): void;
  /** 取消会话；若尚无终态，事件流以 failed + CANCELLED 收尾。 */
  cancel(): void;
}

/** 流式转录专用 Port；不替换、不影响一次性 AudioTranscriptionModelGateway。 */
export interface StreamingTranscriptionGateway {
  beginStreaming(
    request: StreamingTranscriptionRequest,
  ): StreamingTranscriptionSession;
}
