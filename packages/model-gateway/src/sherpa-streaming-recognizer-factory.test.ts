/**
 * V09-E 真实 recognizerFactory 适配测试：SDK 调用映射、边界归一化、
 * 每 Session 独立 recognizer/stream（验收 16）、SDK 异常上抛（由 Session
 * 归一化为稳定码，验收 17）。
 *
 * 用 fake SDK 模拟 sherpa-onnx 的 SherpaWasmOnlineRecognizer/SherpaWasmOnlineStream 行为，
 * 不加载真实 WASM。
 */
import { describe, expect, it, vi } from 'vitest';
import { sherpaModelProfiles } from './sherpa-model-manifest';
import { SherpaWasmRecognizerFactory } from './sherpa-streaming-recognizer-factory';
import type { EnabledSherpaStreamingConfiguration } from './sherpa-streaming-config';
import type {
  SherpaWasmOnlineRecognizer,
  SherpaWasmOnlineRecognizerConfig,
  SherpaWasmOnlineRecognizerResult,
  SherpaWasmOnlineStream,
} from './sherpa-wasm-types';

const PROFILE = sherpaModelProfiles['480ms']!;

const config: EnabledSherpaStreamingConfiguration = {
  enabled: true,
  profile: '480ms',
  modelDirectory: '/models/480ms',
  hotwordsPath: null,
  sessionTimeoutMs: 60_000,
};

const paths = {
  encoder: '/models/480ms/encoder.int8.onnx',
  decoder: '/models/480ms/decoder.onnx',
  joiner: '/models/480ms/joiner.int8.onnx',
  tokens: '/models/480ms/tokens.txt',
  bpeVocab: '/models/480ms/bpe.vocab',
};

/** 可编程 fake stream：记录喂入样本与 inputFinished。 */
class FakeStream implements SherpaWasmOnlineStream {
  sampleRates: number[] = [];
  sampleCounts: number[] = [];
  finished = false;
  freed = false;
  acceptWaveform(sampleRate: number, samples: Float32Array): void {
    this.sampleRates.push(sampleRate);
    this.sampleCounts.push(samples.length);
  }
  inputFinished(): void {
    this.finished = true;
  }
  free(): void {
    this.freed = true;
  }
}

/** 可编程 fake recognizer：text 由外部控制，可注入异常。 */
class FakeRecognizer implements SherpaWasmOnlineRecognizer {
  static instanceCount = 0;
  readonly id: number;
  stream: FakeStream | null = null;
  textProvider: (() => string) | null = null;
  freed = false;

  constructor() {
    FakeRecognizer.instanceCount += 1;
    this.id = FakeRecognizer.instanceCount;
  }
  createStream(): SherpaWasmOnlineStream {
    this.stream = new FakeStream();
    return this.stream;
  }
  /** fake：默认不可解码（模拟帧不足），decode 计数用于验证 isReady 循环。 */
  isReady(_stream: SherpaWasmOnlineStream): boolean {
    return this.readyToDecode;
  }
  decode(_stream: SherpaWasmOnlineStream): void {
    this.decodeCalls += 1;
    // 默认模拟 SDK 消费一块（isReady 变假）；consumeOnDecode=false 时
    // 模拟「isReady 恒真」的 SDK 缺陷，用于验证 decode 循环上限。
    if (this.consumeOnDecode) this.readyToDecode = false;
  }
  isEndpoint(_stream: SherpaWasmOnlineStream): boolean {
    return false;
  }
  reset(_stream: SherpaWasmOnlineStream): void {}
  getResult(_stream: SherpaWasmOnlineStream): SherpaWasmOnlineRecognizerResult {
    // 不使用 `??`：测试需要能注入「返回 undefined」来验证归一化。
    const text = this.textProvider !== null ? this.textProvider() : '识别结果';
    return { text };
  }
  free(): void {
    this.freed = true;
  }

  /** 供测试驱动 isReady 状态。 */
  readyToDecode = false;
  decodeCalls = 0;
  consumeOnDecode = true;
}

const makeFactory = (
  overrides: { textProvider?: () => string; readyToDecode?: boolean } = {},
): { factory: SherpaWasmRecognizerFactory; sdk: typeof FakeRecognizer } => {
  const createOnlineRecognizer = (): SherpaWasmOnlineRecognizer => {
    const recognizer = new FakeRecognizer();
    if (overrides.textProvider !== undefined) {
      recognizer.textProvider = overrides.textProvider;
    }
    if (overrides.readyToDecode !== undefined) {
      recognizer.readyToDecode = overrides.readyToDecode;
    }
    return recognizer;
  };
  const factory = new SherpaWasmRecognizerFactory({
    createOnlineRecognizer,
    profile: PROFILE,
    config,
    paths,
  });
  return { factory, sdk: FakeRecognizer };
};

describe('SherpaWasmRecognizerFactory（V09-E）', () => {
  it('acceptWaveform/decode/getPartialText 映射到 SDK 调用', () => {
    const { factory } = makeFactory({
      textProvider: () => '同学你好',
      readyToDecode: true,
    });
    const recognizer = factory.create();
    const samples = new Float32Array([0.1, -0.2, 0.3]);
    expect(recognizer.acceptWaveform(16_000, samples)).toBe(true);
    recognizer.decode();
    expect(recognizer.getPartialText()).toBe('同学你好');
    const sdkInstance = recognizer as unknown as { recognizer: FakeRecognizer };
    const stream = sdkInstance.recognizer.stream!;
    expect(stream.sampleRates).toEqual([16_000]);
    expect(stream.sampleCounts).toEqual([3]);
  });

  it('decode() 按 isReady 循环驱动：一块可解码时消费一块，消费后停止', () => {
    const { factory } = makeFactory({ readyToDecode: true });
    const recognizer = factory.create();
    recognizer.decode();
    const sdkInstance = recognizer as unknown as { recognizer: FakeRecognizer };
    // 一次 isReady=true → 一次 decode → fake 消费后 isReady=false → 循环退出。
    expect(sdkInstance.recognizer.decodeCalls).toBe(1);
    recognizer.decode();
    // 已不可解码：不再调用 SDK decode。
    expect(sdkInstance.recognizer.decodeCalls).toBe(1);
  });

  it('isReady 恒真（SDK 缺陷）时 decode 达到上限抛错，防同步死循环', () => {
    const { factory } = makeFactory();
    const recognizer = factory.create();
    const sdkInstance = recognizer as unknown as { recognizer: FakeRecognizer };
    sdkInstance.recognizer.readyToDecode = true;
    sdkInstance.recognizer.consumeOnDecode = false;
    expect(() => recognizer.decode()).toThrow('recognizer_decode_stall');
    expect(sdkInstance.recognizer.decodeCalls).toBe(64);
  });

  it('inputFinished 前 getFinalText 为 null，之后为最终文本', () => {
    const { factory } = makeFactory({ textProvider: () => '最终文本' });
    const recognizer = factory.create();
    expect(recognizer.getFinalText()).toBeNull();
    recognizer.inputFinished();
    expect(recognizer.getFinalText()).toBe('最终文本');
  });

  it('验收 16：两次 create 返回独立 recognizer 与独立 stream', () => {
    const { factory, sdk } = makeFactory();
    const before = sdk.instanceCount;
    const first = factory.create();
    const second = factory.create();
    expect(sdk.instanceCount).toBe(before + 2);
    const firstSdk = (first as unknown as { recognizer: FakeRecognizer })
      .recognizer;
    const secondSdk = (second as unknown as { recognizer: FakeRecognizer })
      .recognizer;
    expect(firstSdk).not.toBe(secondSdk);
    expect(firstSdk.stream).not.toBe(secondSdk.stream);
    // 一个会话的 stream 状态不影响另一个。
    first.acceptWaveform(16_000, new Float32Array([1]));
    expect(secondSdk.stream!.sampleCounts).toEqual([]);
  });

  it('createStream 失败时释放已创建的 recognizer', () => {
    const recognizer = new FakeRecognizer();
    recognizer.createStream = () => {
      throw new Error('stream_create_failed');
    };
    const factory = new SherpaWasmRecognizerFactory({
      createOnlineRecognizer: () => recognizer,
      profile: PROFILE,
      config,
      paths,
    });
    expect(() => factory.create()).toThrow('stream_create_failed');
    expect(recognizer.freed).toBe(true);
  });

  it('SDK 返回非字符串 text 归一化为空串', () => {
    const { factory } = makeFactory({
      textProvider: () => undefined as unknown as string,
    });
    const recognizer = factory.create();
    expect(recognizer.getPartialText()).toBe('');
  });

  it('验收 17：SDK 异常原样上抛（由 Session 归一化为稳定码）', () => {
    const { factory } = makeFactory({
      textProvider: () => {
        throw new Error('sdk_internal_failure');
      },
    });
    const recognizer = factory.create();
    expect(() => recognizer.getPartialText()).toThrow('sdk_internal_failure');
  });

  it('free() 释放 stream 与 recognizer，且幂等', () => {
    const { factory } = makeFactory();
    const recognizer = factory.create();
    const sdkInstance = (
      recognizer as unknown as { recognizer: FakeRecognizer }
    ).recognizer;
    const stream = sdkInstance.stream!;
    recognizer.free();
    expect(stream.freed).toBe(true);
    expect(sdkInstance.freed).toBe(true);
    recognizer.free(); // 第二次无副作用
  });

  it('free 后调用抛稳定错误', () => {
    const { factory } = makeFactory();
    const recognizer = factory.create();
    recognizer.free();
    expect(() => recognizer.decode()).toThrow('recognizer_freed');
  });

  it('SDK config 总是携带 bpeVocab（真实 SDK 强制要求），热词启用时附加 hotwordsFile', () => {
    let captured: SherpaWasmOnlineRecognizerConfig | null = null;
    const factory = new SherpaWasmRecognizerFactory({
      createOnlineRecognizer: (sdkConfig) => {
        captured = sdkConfig;
        return new FakeRecognizer();
      },
      profile: PROFILE,
      config: { ...config, hotwordsPath: '/data/hotwords.txt' },
      paths,
    });
    factory.create();
    expect(captured).not.toBeNull();
    expect(captured!.modelConfig.bpeVocab).toBe('/models/480ms/bpe.vocab');
    expect(captured!.hotwordsFile).toBe('/data/hotwords.txt');
    expect(captured!.decodingMethod).toBe('modified_beam_search');
  });

  it('热词未启用时 SDK config 仍携带 bpeVocab 但不携带 hotwordsFile', () => {
    let captured: SherpaWasmOnlineRecognizerConfig | null = null;
    const factory = new SherpaWasmRecognizerFactory({
      createOnlineRecognizer: (sdkConfig) => {
        captured = sdkConfig;
        return new FakeRecognizer();
      },
      profile: PROFILE,
      config,
      paths,
    });
    factory.create();
    expect(captured!.modelConfig.bpeVocab).toBe('/models/480ms/bpe.vocab');
    expect(captured!.hotwordsFile).toBeUndefined();
  });
});
