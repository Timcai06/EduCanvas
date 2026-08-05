/**
 * V08 sherpa 流式转录 Adapter 测试辅助（fake recognizer 与事件构造）。
 *
 * 全部测试只使用 fake recognizer，不读取真实模型、不调用付费 Provider。
 * 本文件按验收标准拆到两个测试文件中共享，避免单一文件超 400 行
 * （tooling/runtime-module-size-boundary.test.mjs 的 model-gateway 护栏）。
 */

import {
  STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
  StreamingTranscriptionStateError,
  streamingTranscriptionProtocolVersion,
  validateStreamingTranscriptionEventSequence,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionFailureCode,
  type StreamingTranscriptionPcmChunk,
  type StreamingTranscriptionRequest,
  type StreamingTranscriptionSession,
} from '@educanvas/agent-core';
import { expect } from 'vitest';
import type { SherpaStreamingRecognizer } from './sherpa-streaming-recognizer';
import {
  SherpaStreamingTranscriptionGateway,
  type SherpaStreamingTranscriptionGatewayOptions,
  type SherpaStreamingTranscriptionLogEntry,
} from './sherpa-streaming-transcription-gateway';

export const operationId = 'op-voice-1';
export const segmentId = 'seg-1';
export const request: StreamingTranscriptionRequest = {
  operationId,
  segmentId,
  traceId: 'trace-voice-1',
};

/** 可编程 fake recognizer：记录所有调用，行为由脚本字段驱动。 */
export class FakeRecognizer implements SherpaStreamingRecognizer {
  readonly chunks: Float32Array[] = [];
  readonly sampleRates: number[] = [];
  totalSamples = 0;
  freeCalls = 0;
  inputFinishedCalls = 0;
  decodeCalls = 0;

  /** 每次 decode 后按序返回的 partial 文本（越界时用最后一个；空则不投影）。 */
  partialScript: readonly string[] = [];
  /** 第 N 次 decode 之后 isEndpoint() 返回 true；Infinity = 从不。 */
  endpointAfterDecode = Infinity;
  /** inputFinished 后的最终文本；null = 尚未就绪（配合超时测试）。 */
  finalText: string | null = null;
  decodeError: unknown;
  acceptError: unknown;
  partialError: unknown;
  endpointError: unknown;
  freeError: unknown;
  acceptResult = true;

  acceptWaveform(sampleRate: number, samples: Float32Array): boolean {
    if (this.acceptError !== undefined) throw this.acceptError;
    this.sampleRates.push(sampleRate);
    this.chunks.push(samples);
    this.totalSamples += samples.length;
    return this.acceptResult;
  }

  decode(): void {
    this.decodeCalls += 1;
    if (this.decodeError !== undefined) throw this.decodeError;
  }

  getPartialText(): string {
    if (this.partialError !== undefined) throw this.partialError;
    if (this.partialScript.length === 0) return '';
    const index = Math.min(this.decodeCalls - 1, this.partialScript.length - 1);
    return this.partialScript[index]!;
  }

  isEndpoint(): boolean {
    if (this.endpointError !== undefined) throw this.endpointError;
    return this.decodeCalls >= this.endpointAfterDecode;
  }

  getFinalText(): string | null {
    return this.finalText;
  }

  inputFinished(): void {
    this.inputFinishedCalls += 1;
  }

  free(): void {
    this.freeCalls += 1;
    if (this.freeError !== undefined) throw this.freeError;
  }
}

export function factoryFor(
  ...fakes: FakeRecognizer[]
): SherpaStreamingTranscriptionGatewayOptions['recognizerFactory'] {
  const queue = [...fakes];
  return { create: () => queue.shift() ?? new FakeRecognizer() };
}

export function createGateway(
  fakes: FakeRecognizer[],
  overrides: Partial<SherpaStreamingTranscriptionGatewayOptions> = {},
): {
  gateway: SherpaStreamingTranscriptionGateway;
  logs: SherpaStreamingTranscriptionLogEntry[];
} {
  const logs: SherpaStreamingTranscriptionLogEntry[] = [];
  const gateway = new SherpaStreamingTranscriptionGateway({
    recognizerFactory: factoryFor(...fakes),
    timeoutMs: 1_000,
    log: (entry) => logs.push(entry),
    ...overrides,
  });
  return { gateway, logs };
}

export function pcmChunk(
  sequence: number,
  byteLength = 32_000,
  sampleValue = 1_000,
  operation = operationId,
  segment = segmentId,
): StreamingTranscriptionPcmChunk {
  const pcmBytes = new Uint8Array(byteLength);
  if (sampleValue !== 0) {
    const view = new DataView(pcmBytes.buffer);
    for (let index = 0; index < byteLength; index += 2) {
      view.setInt16(index, sampleValue, true);
    }
  }
  return {
    operationId: operation,
    segmentId: segment,
    sequence,
    sampleRate: STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
    channels: 1,
    encoding: 'pcm_s16le',
    pcmBytes,
  };
}

export function partialEvent(
  sequence: number,
  text: string,
  operation = operationId,
  segment = segmentId,
): StreamingTranscriptionEvent {
  return {
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: operation,
    segmentId: segment,
    sequence,
    type: 'partial',
    text,
  };
}

export function endpointEvent(
  sequence: number,
  operation = operationId,
  segment = segmentId,
): StreamingTranscriptionEvent {
  return {
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: operation,
    segmentId: segment,
    sequence,
    type: 'endpoint',
  };
}

export function finalEvent(
  sequence: number,
  text: string,
  operation = operationId,
  segment = segmentId,
): StreamingTranscriptionEvent {
  return {
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: operation,
    segmentId: segment,
    sequence,
    type: 'final',
    text,
  };
}

export function failedEvent(
  sequence: number,
  failureCode: StreamingTranscriptionFailureCode,
  operation = operationId,
  segment = segmentId,
): StreamingTranscriptionEvent {
  return {
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: operation,
    segmentId: segment,
    sequence,
    type: 'failed',
    failureCode,
  };
}

export async function collectEvents(
  session: StreamingTranscriptionSession,
): Promise<StreamingTranscriptionEvent[]> {
  const events: StreamingTranscriptionEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

/** 断言动作抛稳定码错误（消息即稳定码，不携带 Provider 细节）。 */
export function assertRejected(
  action: () => void,
  code: StreamingTranscriptionFailureCode,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StreamingTranscriptionStateError);
    const stateError = error as StreamingTranscriptionStateError;
    expect(stateError.code).toBe(code);
    expect(stateError.message).toBe(code);
    return;
  }
  expect.unreachable(`应当抛 ${code}`);
}

/** 断言事件序列符合 V04 序列纪律（sequence 连续、唯一终态）。 */
export function expectValidSequence(
  events: readonly StreamingTranscriptionEvent[],
): void {
  expect(validateStreamingTranscriptionEventSequence(events)).toBe(true);
}
