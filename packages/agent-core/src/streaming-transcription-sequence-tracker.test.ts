/**
 * V13 增量序列验证器等价性测试。
 *
 * 核心断言：对任意消息/事件序列，批量验证器（V04/V07 单源语义）对每个
 * 前缀的结果，与增量 tracker 逐条 accept 的结果完全一致（前缀一致性）。
 * 用穷举类型组合 + 手工非法字段用例覆盖，证明 O(1) 增量版不复制第二套
 * 判定逻辑且无行为漂移。
 */

import { describe, expect, it } from 'vitest';
import {
  streamingTranscriptionProtocolVersion,
  validateStreamingTranscriptionClientMessageSequence,
  validateStreamingTranscriptionEventSequence,
  type StreamingTranscriptionClientMessage,
  type StreamingTranscriptionEvent,
} from './index';
import {
  StreamingTranscriptionClientMessageSequenceTracker,
  StreamingTranscriptionEventSequenceTracker,
} from './streaming-transcription-sequence-tracker';

const PROTO = streamingTranscriptionProtocolVersion;
const AUDIO = {
  sampleRate: 16_000,
  channels: 1,
  encoding: 'pcm_s16le',
} as const;

function clientMessage(
  type: 'start' | 'chunk' | 'finish' | 'cancel',
  sequence: number,
  chunkSequence = 0,
): StreamingTranscriptionClientMessage {
  const base = {
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
  };
  switch (type) {
    case 'start':
      // V07：start 的 sequence 固定为 0（会话起始消息）。
      return { ...base, type, sequence: 0, ...AUDIO };
    case 'chunk':
      return {
        ...base,
        type,
        chunkSequence,
        ...AUDIO,
        pcmBytes: new Uint8Array([0x00, 0x00, 0x01, 0x00]),
      };
    case 'finish':
    case 'cancel':
      return { ...base, type };
  }
}

function eventMessage(
  type: 'partial' | 'endpoint' | 'final' | 'failed',
  sequence: number,
): StreamingTranscriptionEvent {
  const base = {
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
  };
  switch (type) {
    case 'partial':
      return { ...base, type, text: 'partial-text' };
    case 'endpoint':
      return { ...base, type };
    case 'final':
      return { ...base, type, text: 'final-text' };
    case 'failed':
      return { ...base, type, failureCode: 'MODEL_FAILED' };
  }
}

function combinations<T>(values: readonly T[], maxLength: number): T[][] {
  const result: T[][] = [];
  const walk = (prefix: T[]): void => {
    if (prefix.length > 0) result.push(prefix);
    if (prefix.length >= maxLength) return;
    for (const value of values) walk([...prefix, value]);
  };
  walk([]);
  return result;
}

/** 前缀一致性：批量验证每个前缀的结果与逐条 accept 完全一致。 */
function expectClientPrefixEquivalence(types: readonly string[]): void {
  const messages: StreamingTranscriptionClientMessage[] = [];
  let chunkSequence = 0;
  for (let i = 0; i < types.length; i += 1) {
    const message = clientMessage(types[i] as never, i, chunkSequence);
    if (message.type === 'chunk') chunkSequence += 1;
    messages.push(message);
  }
  const tracker = new StreamingTranscriptionClientMessageSequenceTracker();
  let allAccepted = true;
  for (let i = 0; i < messages.length; i += 1) {
    const batchOk = validateStreamingTranscriptionClientMessageSequence(
      messages.slice(0, i + 1),
    );
    const stepOk = tracker.accept(messages[i]!);
    expect(stepOk).toBe(batchOk && allAccepted);
    allAccepted = allAccepted && stepOk;
  }
}

function expectEventPrefixEquivalence(types: readonly string[]): void {
  const events = types.map((type, i) => eventMessage(type as never, i));
  const tracker = new StreamingTranscriptionEventSequenceTracker();
  let allAccepted = true;
  for (let i = 0; i < events.length; i += 1) {
    const batchOk = validateStreamingTranscriptionEventSequence(
      events.slice(0, i + 1),
    );
    const stepOk = tracker.accept(events[i]!);
    expect(stepOk).toBe(batchOk && allAccepted);
    allAccepted = allAccepted && stepOk;
  }
}

describe('StreamingTranscriptionClientMessageSequenceTracker（V13 O(1)）', () => {
  it('穷举 start/chunk/finish/cancel 组合（长度 1..6）与批量验证器前缀一致', () => {
    const all = combinations(
      ['start', 'chunk', 'finish', 'cancel'] as const,
      6,
    );
    for (const types of all) expectClientPrefixEquivalence(types);
  });

  it('sequence 跳号/重复与批量验证器一致拒绝', () => {
    const tracker = new StreamingTranscriptionClientMessageSequenceTracker();
    expect(tracker.accept(clientMessage('start', 0, 0))).toBe(true);
    // 跳号：期望 sequence 1，收到 2。
    expect(tracker.accept(clientMessage('chunk', 2, 0))).toBe(false);
    const gap = new StreamingTranscriptionClientMessageSequenceTracker();
    expect(gap.accept(clientMessage('start', 0, 0))).toBe(true);
    expect(gap.accept(clientMessage('chunk', 1, 0))).toBe(true);
    // 重复 sequence：期望 2，收到 1。
    expect(gap.accept(clientMessage('finish', 1))).toBe(false);
  });

  it('chunkSequence 跳号与批量验证器一致拒绝', () => {
    const tracker = new StreamingTranscriptionClientMessageSequenceTracker();
    expect(tracker.accept(clientMessage('start', 0, 0))).toBe(true);
    expect(tracker.accept(clientMessage('chunk', 1, 0))).toBe(true);
    // 期望 chunkSequence 1，收到 2。
    expect(tracker.accept(clientMessage('chunk', 2, 2))).toBe(false);
  });

  it('首条非 start 与跨身份消息拒绝', () => {
    const tracker = new StreamingTranscriptionClientMessageSequenceTracker();
    expect(tracker.accept(clientMessage('chunk', 0, 0))).toBe(false);
    // sticky：违约后永久拒绝，后续合法消息不会让序列"重新开始"。
    expect(tracker.accept(clientMessage('start', 0, 0))).toBe(false);
    expect(tracker.isViolated).toBe(true);
    const cross = new StreamingTranscriptionClientMessageSequenceTracker();
    expect(cross.accept(clientMessage('start', 0, 0))).toBe(true);
    const foreign = {
      ...clientMessage('chunk', 1, 0),
      operationId: 'op:other',
    };
    expect(cross.accept(foreign)).toBe(false);
    expect(cross.accept(clientMessage('chunk', 1, 0))).toBe(false);
  });

  it('暴露 acceptedCount 与 terminalActionSeen 状态', () => {
    const tracker = new StreamingTranscriptionClientMessageSequenceTracker();
    expect(tracker.acceptedCount).toBe(0);
    expect(tracker.terminalActionSeen).toBe(false);
    expect(tracker.accept(clientMessage('start', 0, 0))).toBe(true);
    expect(tracker.accept(clientMessage('chunk', 1, 0))).toBe(true);
    expect(tracker.accept(clientMessage('finish', 2))).toBe(true);
    expect(tracker.acceptedCount).toBe(3);
    expect(tracker.terminalActionSeen).toBe(true);
  });
});

describe('StreamingTranscriptionEventSequenceTracker（V13 O(1)）', () => {
  it('穷举 partial/endpoint/final/failed 组合（长度 1..5）与批量验证器前缀一致', () => {
    const all = combinations(
      ['partial', 'endpoint', 'final', 'failed'] as const,
      5,
    );
    for (const types of all) expectEventPrefixEquivalence(types);
  });

  it('sequence 跳号/重复与批量验证器一致拒绝', () => {
    const tracker = new StreamingTranscriptionEventSequenceTracker();
    expect(tracker.accept(eventMessage('partial', 0))).toBe(true);
    expect(tracker.accept(eventMessage('partial', 2))).toBe(false);
    // sticky：违约后即使补上缺失的 sequence 也永久拒绝。
    expect(tracker.accept(eventMessage('partial', 1))).toBe(false);
    expect(tracker.isViolated).toBe(true);
    const gap = new StreamingTranscriptionEventSequenceTracker();
    expect(gap.accept(eventMessage('partial', 0))).toBe(true);
    expect(gap.accept(eventMessage('partial', 1))).toBe(true);
    expect(gap.accept(eventMessage('partial', 1))).toBe(false);
  });

  it('跨身份事件拒绝', () => {
    const tracker = new StreamingTranscriptionEventSequenceTracker();
    expect(tracker.accept(eventMessage('partial', 0))).toBe(true);
    expect(
      tracker.accept({
        ...eventMessage('partial', 1),
        segmentId: 'seg:other',
      }),
    ).toBe(false);
  });

  it('暴露 acceptedCount 与 terminalSeen 状态', () => {
    const tracker = new StreamingTranscriptionEventSequenceTracker();
    expect(tracker.accept(eventMessage('partial', 0))).toBe(true);
    expect(tracker.accept(eventMessage('endpoint', 1))).toBe(true);
    expect(tracker.accept(eventMessage('final', 2))).toBe(true);
    expect(tracker.acceptedCount).toBe(3);
    expect(tracker.terminalSeen).toBe(true);
    // 终态后任何事件拒绝（状态未推进）。
    expect(tracker.accept(eventMessage('failed', 3))).toBe(false);
  });
});
