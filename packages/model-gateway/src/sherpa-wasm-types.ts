/**
 * sherpa-onnx 1.13.4 WASM SDK 的最小本地类型面（内部边界，index.ts 不导出
 * Provider/SDK 模块类型）。
 *
 * npm 包 `sherpa-onnx` 不携带 .d.ts（1.13.4 实测只有 index.js 与 wasm
 * 二进制），且 `declare module` 在该包安装后会因「未类型化模块无法增强」被
 * 编译器拒绝。因此这里定义本仓库自己的镜像接口，结构对齐真实导出面：
 *
 * - `createOnlineRecognizer(config)` 同步创建识别器（index.js 顶层同步实例化
 *   WASM 模块，所有 recognizer 共享同一 WASM runtime、各自独立 handle）；
 * - decode/isEndpoint/getResult/reset/free 都要求显式传入流（V08 内部接口
 *   把「流」折叠进 recognizer，由适配层持有 stream）；
 * - getResult 的 `text` 在输入未结束时是可修正假设文本，inputFinished 后为
 *   最终文本——适配层据此投影 partial/final（不可信输入，文本必须再经 V04
 *   schema 校验后才成为领域事件）。
 *
 * 运行时加载走 `loadSherpaOnnxSdk()` 的 createRequire；本文件只有类型，
 * 不产生运行时导入。
 */

/** 单次解码结果（getResult 的 JSON.parse 产物）；`text` 是不可信输入。 */
export interface SherpaWasmOnlineRecognizerResult {
  text: string;
  tokens?: string[];
  timestamps?: number[];
  isFinal?: boolean;
}

/** 单个在线流：喂入 16 kHz 单声道 Float32 PCM（-1..1）。 */
export interface SherpaWasmOnlineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
  free(): void;
}

/** 在线识别器；同一实例可创建多个流，但本项目每个 recognizer 只服务一个会话。 */
export interface SherpaWasmOnlineRecognizer {
  createStream(): SherpaWasmOnlineStream;
  /** 流内已积累的帧是否足够一次 decode（在线模式的驱动判断）。 */
  isReady(stream: SherpaWasmOnlineStream): boolean;
  decode(stream: SherpaWasmOnlineStream): void;
  isEndpoint(stream: SherpaWasmOnlineStream): boolean;
  reset(stream: SherpaWasmOnlineStream): void;
  getResult(stream: SherpaWasmOnlineStream): SherpaWasmOnlineRecognizerResult;
  free(): void;
}

/** 在线（流式）transducer 模型文件配置；路径为部署机上的绝对路径。 */
export interface SherpaWasmOnlineTransducerModelConfig {
  encoder: string;
  decoder: string;
  joiner: string;
}

/** OnlineRecognizerConfig 的 modelConfig 子集（transducer + 词表）。 */
export interface SherpaWasmOnlineModelConfig {
  transducer: SherpaWasmOnlineTransducerModelConfig;
  tokens: string;
  numThreads?: number;
  provider?: string;
  debug?: boolean;
  modelType?: string;
  modelingUnit?: 'cjkchar' | 'cjkchar+bpe' | 'bpe';
  bpeVocab?: string;
}

/** 特征提取配置；本项目固定 16 kHz / 80 维 fbank。 */
export interface SherpaWasmOnlineFeatureConfig {
  sampleRate: number;
  featureDim: number;
}

/** 传给 `createOnlineRecognizer` 的完整配置。 */
export interface SherpaWasmOnlineRecognizerConfig {
  featConfig: SherpaWasmOnlineFeatureConfig;
  modelConfig: SherpaWasmOnlineModelConfig;
  decodingMethod: 'greedy_search' | 'modified_beam_search';
  maxActivePaths?: number;
  enableEndpoint?: number;
  hotwordsFile?: string;
  hotwordsScore?: number;
}

/** SDK 最小能力面：创建在线识别器（每个 Session 一个独立实例）。 */
export interface SherpaWasmSdk {
  createOnlineRecognizer(
    config: SherpaWasmOnlineRecognizerConfig,
  ): SherpaWasmOnlineRecognizer;
}
