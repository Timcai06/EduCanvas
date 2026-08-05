/**
 * sherpa WASM SIMD 流式转录 Adapter（V08）。
 *
 * 实现 agent-core 的 `StreamingTranscriptionGateway` Port：负责 recognizer
 * 生命周期、PCM 喂入、事件投影、取消、超时和安全错误归一化。V08 只用
 * fake recognizer 验证，不读取真实模型；V09 的配置闸门注入真实
 * sherpa-onnx WASM 实现。
 *
 * ## 输入侧复用（不复制领域逻辑）
 *
 * - 单分片格式校验：V04 `streamingTranscriptionPcmChunkSchema`
 *   （非法分片 → INVALID_PCM_CHUNK）；
 * - 会话归属 / sequence 连续性 / endpoint / finish / cancel 状态机：
 *   V06 segmentation policy（重复、跳号、跨 operation/segment → UNKNOWN，
 *   endpoint/finish/终态后输入 → INPUT_AFTER_* 稳定码）。
 *
 * ## 事件投影
 *
 * - recognizer 输出视为不可信：partial / final 文本必须通过 V04
 *   `streamingTranscriptionEventSchema`（空白、超长、非字符串拒绝）；
 * - 事件 sequence 从 0 独立连续递增，与 PCM chunk 的 sequence 分域
 *   （V07 envelope 已确立该纪律）；
 * - 唯一终态纪律：final / failed 是仅有两个终态，endpoint 不是终态；
 *   cancel / abort / 超时 / recognizer 异常只会投影一个 failed 终态。
 *
 * ## 安全错误面
 *
 * 公共事件与异常只暴露稳定 failureCode，不含 PCM 字节、转录全文、模型
 * 路径、Provider 原始 body、stack 或 API Key；日志只记录稳定标签。
 * recognizer 释放（free）抛错不能覆盖已形成的终态。
 *
 * 单个 Session 的实现（`SherpaStreamingTranscriptionSession`）在内部模块
 * `sherpa-streaming-transcription-session.ts`，不从本入口导出。
 */

import type {
  StreamingTranscriptionFailureCode,
  StreamingTranscriptionGateway,
  StreamingTranscriptionRequest,
  StreamingTranscriptionSession,
} from '@educanvas/agent-core';
import type { SherpaStreamingRecognizerFactory } from './sherpa-streaming-recognizer';
import { SherpaStreamingTranscriptionSession } from './sherpa-streaming-transcription-session';

/** 稳定日志标签；日志条目绝不携带转录文本、PCM、路径或堆栈。 */
export type SherpaStreamingTranscriptionLogLabel =
  'session_started' | 'session_ended' | 'input_rejected';

/** 会话日志条目（脱敏）：只有身份与稳定码，供审计与诊断。 */
export interface SherpaStreamingTranscriptionLogEntry {
  readonly label: SherpaStreamingTranscriptionLogLabel;
  readonly operationId: string;
  readonly segmentId: string;
  readonly failureCode?: StreamingTranscriptionFailureCode;
}

/**
 * 受控配置。recognizerFactory 由 V09 组合闸门注入真实实现；本任务只接受
 * 注入，不读取模型路径或环境变量。timeoutMs 是会话级兜底超时：从
 * beginStreaming 起算，到期未终态 → failed + MODEL_FAILED。
 */
export interface SherpaStreamingTranscriptionGatewayOptions {
  recognizerFactory: SherpaStreamingRecognizerFactory;
  /** 会话超时毫秒数；到期未形成终态时投影 failed + MODEL_FAILED。 */
  timeoutMs: number;
  /** 注入时钟（默认 Date.now；测试用 fake timers 控制）。 */
  now?: () => number;
  /** 注入等待原语（默认 setTimeout Promise；测试用 fake timers 控制）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 注入脱敏日志；缺省时静默。 */
  log?: (entry: SherpaStreamingTranscriptionLogEntry) => void;
}

/**
 * sherpa WASM 流式转录 Adapter。每个 `beginStreaming` 返回独立 Session，
 * Session 之间状态完全隔离（各自的 recognizer 实例、输入状态机与事件流）。
 */
export class SherpaStreamingTranscriptionGateway implements StreamingTranscriptionGateway {
  private readonly options: SherpaStreamingTranscriptionGatewayOptions;

  constructor(options: SherpaStreamingTranscriptionGatewayOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new TypeError('timeoutMs 必须为正数');
    }
    this.options = options;
  }

  beginStreaming(
    request: StreamingTranscriptionRequest,
  ): StreamingTranscriptionSession {
    return new SherpaStreamingTranscriptionSession(this.options, request);
  }
}
