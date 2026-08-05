/**
 * sherpa-onnx WASM 在线识别器到 V08 内部接口的最小适配（V09-E）。
 *
 * 职责边界：
 *
 * - 本模块是 model-gateway 内部模块，只实现 V08-B 的
 *   `SherpaStreamingRecognizer` / `SherpaStreamingRecognizerFactory`；
 *   Provider/SDK 类型（`sherpa-onnx`）绝不从 index.ts 公共导出；
 * - 组合闸门（`sherpa-streaming-gateway-resolver.ts`）全部校验通过后才把
 *   SDK 工厂注入这里；本模块不做文件存在性/checksum 校验，那是闸门职责；
 * - 每个 `create()` 都构造独立的 OnlineRecognizer 与 OnlineStream，Session
 *   之间不共享可变 stream；WASM runtime 由 `sherpa-onnx` 包内单例共享，
 *   但 handle 各自独立（SDK 设计如此）；
 * - SDK 的返回值与异常在这里做边界归一化：`getResult().text` 非字符串时按
 *   空串处理；SDK 抛出的原始异常不吞不包装——由 V08 Session 的 try/catch
 *   归一化为稳定 failureCode（MODEL_FAILED），日志绝不携带路径或 stack。
 *
 * 模型路径只在本模块内部组合进 SDK config，不写入日志、事件或异常消息。
 */
import { createRequire } from 'node:module';
import type { SherpaStreamingRecognizer } from './sherpa-streaming-recognizer';
import type { SherpaStreamingRecognizerFactory } from './sherpa-streaming-recognizer';
import type { SherpaModelProfile } from './sherpa-model-manifest';
import type { EnabledSherpaStreamingConfiguration } from './sherpa-streaming-config';
import type {
  SherpaWasmOnlineRecognizer,
  SherpaWasmOnlineRecognizerConfig,
  SherpaWasmOnlineStream,
  SherpaWasmSdk,
} from './sherpa-wasm-types';

/** 归一化 SDK 返回的文本：非字符串一律空串（V04 schema 再兜底拒绝）。 */
const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * 单个会话的 SDK 适配句柄。持有独立的 OnlineRecognizer + OnlineStream；
 * `free()` 后不得再调用任何方法。
 *
 * ## 驱动纪律（真实 SDK 验证，2026-06-05 zipformer2 模型）
 *
 * 这些模型的每次 decode 需要 >= 模型 T 帧（480ms: 61 帧，1920ms: 205 帧），
 * 且 fbank 缓冲有上限；官方在线模式是「acceptWaveform 任意分片 + 在
 * isReady() 为真时循环 decode」。因此 decode() 必须循环到 isReady 为假，
 * 否则 100ms 分片会先触发帧不足崩溃、后因缓冲累积超限崩溃。
 */
class SherpaWasmStreamingRecognizer implements SherpaStreamingRecognizer {
  private readonly recognizer: SherpaWasmOnlineRecognizer;
  private readonly stream: SherpaWasmOnlineStream;
  private inputFinishedFlag = false;
  private freed = false;

  constructor(
    recognizer: SherpaWasmOnlineRecognizer,
    stream: SherpaWasmOnlineStream,
  ) {
    this.recognizer = recognizer;
    this.stream = stream;
  }

  acceptWaveform(sampleRate: number, samples: Float32Array): boolean {
    if (this.freed) throw new Error('recognizer_freed');
    // SDK 的 acceptWaveform 无返回值；V08 接口要求 boolean（false 可忽略）。
    this.stream.acceptWaveform(sampleRate, samples);
    return true;
  }

  decode(): void {
    if (this.freed) throw new Error('recognizer_freed');
    // isReady 循环是 SDK 在线模式的正确驱动；单次 decode 只消费一个
    // decode_chunk_len 块，喂入量可能包含多个块。上限是防御性护栏：
    // 若 SDK 出现「isReady 恒真但不消费帧」的实现缺陷，同步循环会饿死
    // 事件循环并绕过会话超时，因此超过物理上界（64 块 × 205 帧）即中止。
    let rounds = 0;
    while (this.recognizer.isReady(this.stream)) {
      if (rounds >= 64) throw new Error('recognizer_decode_stall');
      this.recognizer.decode(this.stream);
      rounds += 1;
    }
  }

  getPartialText(): string {
    // inputFinished 前的 getResult().text 是可修正假设文本；异常由 Session 归一化。
    return normalizeText(this.recognizer.getResult(this.stream).text);
  }

  isEndpoint(): boolean {
    return this.recognizer.isEndpoint(this.stream);
  }

  getFinalText(): string | null {
    // V08 语义：inputFinished 之前无最终文本；之后 getResult().text 即最终文本
    //（Session 在 finish 后已喂 1.5s 尾部静音并继续 decode 推进）。
    if (!this.inputFinishedFlag) return null;
    return normalizeText(this.recognizer.getResult(this.stream).text);
  }

  inputFinished(): void {
    if (this.freed) throw new Error('recognizer_freed');
    this.stream.inputFinished();
    this.inputFinishedFlag = true;
  }

  free(): void {
    if (this.freed) return;
    this.freed = true;
    // 先释放 stream 再释放 recognizer；任一抛错都不阻止另一个的释放。
    let streamError: unknown;
    try {
      this.stream.free();
    } catch (error) {
      streamError = error;
    }
    try {
      this.recognizer.free();
    } finally {
      // 释放失败不向外泄漏：V08 cleanup 已保证 free 抛错不覆盖终态。
      if (streamError !== undefined) throw streamError;
    }
  }
}

/** 每个 Session 一个 SDK OnlineRecognizer + OnlineStream；无跨 Session 共享可变状态。 */
export class SherpaWasmRecognizerFactory implements SherpaStreamingRecognizerFactory {
  private readonly sdkConfig: SherpaWasmOnlineRecognizerConfig;
  private readonly createOnlineRecognizer: (
    config: SherpaWasmOnlineRecognizerConfig,
  ) => SherpaWasmOnlineRecognizer;

  constructor(options: {
    createOnlineRecognizer: (
      config: SherpaWasmOnlineRecognizerConfig,
    ) => SherpaWasmOnlineRecognizer;
    profile: SherpaModelProfile;
    config: EnabledSherpaStreamingConfiguration;
    /** 模型目录下的必需文件相对名 → 绝对路径；bpeVocab 必须始终提供。 */
    paths: {
      encoder: string;
      decoder: string;
      joiner: string;
      tokens: string;
      bpeVocab: string;
    };
  }) {
    const { profile, config, paths } = options;
    const hotwordsEnabled = config.hotwordsPath !== null;
    this.createOnlineRecognizer = options.createOnlineRecognizer;
    this.sdkConfig = {
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: paths.encoder,
          decoder: paths.decoder,
          joiner: paths.joiner,
        },
        tokens: paths.tokens,
        numThreads: 1,
        provider: 'cpu',
        debug: false,
        modelingUnit:
          profile.modelingUnit as SherpaWasmOnlineRecognizerConfig['modelConfig']['modelingUnit'],
        // 真实 SDK 强制要求：modelingUnit=cjkchar+bpe 时 bpeVocab 必须非空，
        // 否则创建识别器直接失败（online-model-config.cc 校验）。因此
        // bpe.vocab 是模型目录的必需文件，与是否启用热词无关。
        bpeVocab: paths.bpeVocab,
      },
      // 热词仅在 modified_beam_search 下生效（官方文档明示）；本任务固定使用
      // profile 声明的解码方法，热词启用与否只影响是否传 hotwordsFile。
      // manifest 与 SDK 字面量的一致性由 manifest 冻结数据保证（V09-B）。
      decodingMethod:
        profile.decodingMethod as SherpaWasmOnlineRecognizerConfig['decodingMethod'],
      maxActivePaths: profile.maxActivePaths,
      enableEndpoint: 1,
      ...(hotwordsEnabled ? { hotwordsFile: config.hotwordsPath! } : {}),
    };
  }

  create(): SherpaStreamingRecognizer {
    const recognizer = this.createOnlineRecognizer(this.sdkConfig);
    try {
      const stream = recognizer.createStream();
      return new SherpaWasmStreamingRecognizer(recognizer, stream);
    } catch (error) {
      // createStream 失败时 Session 尚未拿到句柄，无法替我们 cleanup；
      // 工厂必须释放已创建的 WASM recognizer，避免失败重试持续泄漏内存。
      try {
        recognizer.free();
      } catch {
        // 清理异常不得覆盖原始创建失败；Session 会把它归一化为稳定码。
      }
      throw error;
    }
  }
}

/**
 * 默认 SDK 装载：model-gateway 是 ESM 包，用 createRequire 同步加载 CJS
 * 的 `sherpa-onnx`（其顶层同步实例化 WASM 模块）。仅当闸门全部校验通过后
 * 才调用，避免默认关闭时加载 512MB WASM 运行时与 worker 线程。
 */
export function loadSherpaOnnxSdk(): SherpaWasmSdk {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('sherpa-onnx') as SherpaWasmSdk;
  return sdk;
}
