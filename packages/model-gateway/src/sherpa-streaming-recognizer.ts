/**
 * sherpa WASM 流式识别器内部边界（V08-B）。
 *
 * 本模块只定义 model-gateway 内部可用的最小同步接口，与公共
 * `StreamingTranscriptionGateway` Port 隔离：
 *
 * - 公共入口（`index.ts`）绝不导出本模块的任何符号，外部消费者只能拿到
 *   `SherpaStreamingTranscriptionGateway` 及其受控 options；
 * - 接口只表达真实 sherpa-onnx WASM 在线识别器（OnlineRecognizer）的最小
 *   子集：acceptWaveform / decode / partial / final / endpoint /
 *   inputFinished / free，不引用 sherpa、onnx 或 WASM SDK 类型；
 * - V09 的模型获取与配置闸门负责把真实 sherpa-onnx WASM 实例适配到本
 *   接口；V08 只用 fake recognizer 验证 Adapter 行为，不读取真实模型。
 *
 * 采样格式：接口接收 16 kHz 单声道 Float32 PCM（-1..1），采样率由调用方
 * 用领域常量传入；Adapter 负责把 V04 的 pcm_s16le 分片确定性转换后喂入。
 * recognizer 的输出（文本、endpoint 判定）一律视为不可信输入，由 Adapter
 * 在投影领域事件前用 V04 schema 校验。
 */

/**
 * 单个流式会话的识别器句柄。每次 `create()` 都返回独立实例，禁止跨会话
 * 共享；`free()` 后实例不得再使用。
 */
export interface SherpaStreamingRecognizer {
  /** 接受一帧 16 kHz 单声道 Float32 PCM；返回是否接受（false 可忽略）。 */
  acceptWaveform(sampleRate: number, samples: Float32Array): boolean;
  /** 推进一次解码；在 acceptWaveform 之后调用，之后可查询结果。 */
  decode(): void;
  /** 当前可修正假设文本；无假设时返回空串。 */
  getPartialText(): string;
  /** 是否已检测到输入端点（停顿/静音）；endpoint 不是终态。 */
  isEndpoint(): boolean;
  /**
   * inputFinished 之后的最终文本；尚未就绪时返回 null（调用方继续
   * decode 推进，直到非 null 或会话超时）。
   */
  getFinalText(): string | null;
  /** 通知输入结束，触发尾部 flush；之后仍可调用 decode 推进。 */
  inputFinished(): void;
  /** 释放底层 WASM 内存；Adapter 保证最多调用一次。 */
  free(): void;
}

/** 创建独立识别器实例的工厂；受控注入，不在本任务读取模型路径或环境变量。 */
export interface SherpaStreamingRecognizerFactory {
  create(): SherpaStreamingRecognizer;
}
