/**
 * V12 通道核心测试（transport-neutral，不涉及 WebSocket）。
 *
 * 使用 fake resolver/session（`streaming-transcription-test-support`），
 * 验证生命周期状态机、唯一终态、清理与安全错误面。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  streamingTranscriptionProtocolVersion,
  type StreamingTranscriptionClientMessage,
  type StreamingTranscriptionServerMessage,
} from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import {
  StreamingTranscriptionChannel,
  type StreamingTranscriptionChannelLogEntry,
} from './streaming-transcription-channel';
import {
  FakeTranscriptionGateway,
  VALID_PCM_BYTES,
} from './streaming-transcription-test-support';

const AUDIO = {
  sampleRate: 16_000,
  channels: 1,
  encoding: 'pcm_s16le',
} as const;

function startMessage(): StreamingTranscriptionClientMessage {
  // V07：start 的 sequence 固定为 0（会话起始消息）。
  return {
    type: 'start',
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence: 0,
    ...AUDIO,
  };
}

function chunkMessage(
  sequence: number,
  chunkSequence = 0,
): StreamingTranscriptionClientMessage {
  return {
    type: 'chunk',
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
    chunkSequence,
    ...AUDIO,
    pcmBytes: VALID_PCM_BYTES,
  };
}

function finishMessage(sequence: number): StreamingTranscriptionClientMessage {
  return {
    type: 'finish',
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
  };
}

function cancelMessage(sequence: number): StreamingTranscriptionClientMessage {
  return {
    type: 'cancel',
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
  };
}

interface Harness {
  channel: StreamingTranscriptionChannel;
  gateway: FakeTranscriptionGateway;
  events: StreamingTranscriptionServerMessage[];
  protocolErrors: number;
  closes: Array<1008 | 1011>;
  quotaErrors: string[];
  logs: StreamingTranscriptionChannelLogEntry[];
}

function createHarness(
  config: ConstructorParameters<typeof FakeTranscriptionGateway>[0] = {},
): Harness {
  const gateway = new FakeTranscriptionGateway(config);
  const events: StreamingTranscriptionServerMessage[] = [];
  let protocolErrors = 0;
  const closes: Array<1008 | 1011> = [];
  const quotaErrors: string[] = [];
  const logs: StreamingTranscriptionChannelLogEntry[] = [];
  const channel = new StreamingTranscriptionChannel({
    gateway,
    createTraceId: () => 'trace:test',
    sendEvent: (event) => events.push(event),
    sendProtocolError: () => {
      protocolErrors += 1;
    },
    sendQuotaError: (code) => quotaErrors.push(code),
    close: (code) => closes.push(code),
    log: (entry) => logs.push(entry),
  });
  return {
    channel,
    gateway,
    events,
    closes,
    quotaErrors,
    logs,
    // getter：闭包内 `protocolErrors += 1` 修改的是 createHarness 的局部
    // 变量，必须通过 getter 读取当前值，否则返回的是创建时快照（恒为 0）。
    get protocolErrors() {
      return protocolErrors;
    },
  };
}

/** 等待微任务队列排空（drainEvents 的 for-await 消费是异步的）。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('StreamingTranscriptionChannel 合法会话', () => {
  it('测试5：start → chunk → partial → finish → final', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1));
    harness.channel.handle(finishMessage(2));
    await flush();
    expect(harness.gateway.sessions).toHaveLength(1);
    const session = harness.gateway.sessions[0]!;
    expect(session.pushedChunks).toHaveLength(1);
    expect(session.finishCalls).toBe(1);
    const types = harness.events.map((event) => event.type);
    expect(types).toContain('partial');
    expect(types).toContain('final');
    expect(harness.protocolErrors).toBe(0);
    expect(harness.closes).toEqual([]);
  });

  it('测试6：endpoint 后产生 final', async () => {
    const harness = createHarness({ session: { endpointAfterChunks: 1 } });
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1));
    harness.channel.handle(finishMessage(2));
    await flush();
    const types = harness.events.map((event) => event.type);
    expect(types).toContain('endpoint');
    expect(types.indexOf('endpoint')).toBeLessThan(types.indexOf('final'));
  });

  it('测试16：两个通道实例状态完全隔离', async () => {
    const first = createHarness();
    const second = createHarness();
    first.channel.handle(startMessage());
    second.channel.handle(startMessage());
    first.channel.handle(chunkMessage(1));
    second.channel.handle(chunkMessage(1));
    first.channel.handle(cancelMessage(2));
    await flush();
    expect(first.gateway.sessions).toHaveLength(1);
    expect(second.gateway.sessions).toHaveLength(1);
    expect(first.gateway.sessions[0]!.pushedChunks).toHaveLength(1);
    expect(second.gateway.sessions[0]!.pushedChunks).toHaveLength(1);
    expect(first.gateway.sessions[0]!.cancelCalls).toBe(1);
    expect(second.gateway.sessions[0]!.cancelCalls).toBe(0);
    // first 已终态（CANCELLED），second 仍活跃：second 再 finish 正常收 final。
    second.channel.handle(finishMessage(2));
    await flush();
    const secondTypes = second.events.map((event) => event.type);
    expect(secondTypes).toContain('final');
  });
});

describe('StreamingTranscriptionChannel 协议拒绝', () => {
  it('测试7：重复 start 拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(startMessage());
    expect(harness.protocolErrors).toBe(1);
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.sessions).toHaveLength(1);
  });

  it('测试8：重复 finish 拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    harness.channel.handle(finishMessage(2));
    expect(harness.protocolErrors).toBe(1);
    expect(harness.closes).toContain(1008);
  });

  it('测试9：finish 后 chunk 拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    harness.channel.handle(chunkMessage(2));
    expect(harness.protocolErrors).toBe(1);
    expect(harness.closes).toContain(1008);
  });

  it('cancel 后 chunk 拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(cancelMessage(1));
    harness.channel.handle(chunkMessage(2));
    expect(harness.protocolErrors).toBe(1);
    expect(harness.closes).toContain(1008);
  });

  it('首条消息不是 start 拒绝', () => {
    const harness = createHarness();
    harness.channel.handle(finishMessage(0));
    expect(harness.protocolErrors).toBe(1);
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.beginCalls).toBe(0);
  });

  it('跨 operationId 消息拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle({
      ...chunkMessage(1),
      operationId: 'op:other',
    });
    expect(harness.protocolErrors).toBe(1);
  });

  it('sequence 跳号拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(2)); // 跳过 sequence 1
    expect(harness.protocolErrors).toBe(1);
  });

  it('chunkSequence 不连续拒绝', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1, 0));
    harness.channel.handle(chunkMessage(2, 2)); // 跳过 chunkSequence 1
    expect(harness.protocolErrors).toBe(1);
  });

  it('终态后消息拒绝（terminal 双保险）', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    await flush();
    // 终态已锁；任意后续消息直接协议拒绝。
    harness.channel.handle(finishMessage(2));
    expect(harness.protocolErrors).toBe(1);
  });
});

describe('StreamingTranscriptionChannel 取消与竞争', () => {
  it('测试10：cancel 收敛为 failed + CANCELLED', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(cancelMessage(1));
    await flush();
    const failed = harness.events.filter((event) => event.type === 'failed');
    expect(failed).toHaveLength(1);
    if (failed[0]?.type === 'failed') {
      expect(failed[0].failureCode).toBe('CANCELLED');
    }
  });

  it('测试11：disconnect 自动取消未终态 Session', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.disconnect();
    await flush();
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
    expect(harness.gateway.sessions[0]!.terminalEvent?.type).toBe('failed');
  });

  it('测试12：cancel 与 adapter 失败竞争只有一个终态', async () => {
    const harness = createHarness({ session: { failImmediately: true } });
    harness.channel.handle(startMessage());
    harness.channel.handle(cancelMessage(1)); // Session 已终态，cancel 被忽略
    await flush();
    const failed = harness.events.filter((event) => event.type === 'failed');
    expect(failed).toHaveLength(1);
    if (failed[0]?.type === 'failed') {
      expect(failed[0].failureCode).toBe('MODEL_FAILED');
    }
    expect(harness.closes).toEqual([]); // 竞争只收敛，不触发协议错误
  });

  it('disconnect 与 finish 竞争：abort 抢占已收敛会话不产生第二个终态', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    harness.channel.disconnect(); // abort 在 finish 后：V08 语义下 finished 阶段 abort → CANCELLED
    await flush();
    const failed = harness.events.filter((event) => event.type === 'failed');
    const finals = harness.events.filter((event) => event.type === 'final');
    expect(failed.length + finals.length).toBeLessThanOrEqual(1);
  });
});

describe('StreamingTranscriptionChannel 适配器错误面', () => {
  it('测试13：adapter 创建失败投影 failed + MODEL_FAILED', async () => {
    const harness = createHarness({ createFailure: true });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.gateway.beginCalls).toBe(1);
    const failed = harness.events.filter((event) => event.type === 'failed');
    expect(failed).toHaveLength(1);
    if (failed[0]?.type === 'failed') {
      expect(failed[0].failureCode).toBe('MODEL_FAILED');
    }
    // 通道进入终态：后续消息协议拒绝。
    harness.channel.handle(chunkMessage(1));
    expect(harness.protocolErrors).toBe(1);
  });

  it('测试15：adapter 事件 schema 非法 → 关闭连接且不投影', async () => {
    const harness = createHarness({ session: { emitInvalidEvent: true } });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.closes).toContain(1011);
    expect(harness.events).toHaveLength(0);
    expect(
      harness.logs.some((entry) => entry.label === 'invalid_adapter_event'),
    ).toBe(true);
    // 事件流违约即终态：后续消息协议拒绝，chunk 不进入已死会话。
    harness.channel.handle(chunkMessage(1));
    expect(harness.protocolErrors).toBe(1);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(0);
    // 终态清理：session_ended 日志只出现一次（enterTerminal 幂等）。
    expect(
      harness.logs.filter((entry) => entry.label === 'session_ended'),
    ).toHaveLength(1);
  });

  it('adapter 双终态（两个结构合法 final）→ 只投影一个 + 关闭（1011）', async () => {
    const harness = createHarness({ session: { emitDoubleTerminal: true } });
    harness.channel.handle(startMessage());
    await flush();
    const finals = harness.events.filter((event) => event.type === 'final');
    expect(finals).toHaveLength(1);
    expect(harness.closes).toContain(1011);
    expect(
      harness.logs.some((entry) => entry.label === 'invalid_adapter_event'),
    ).toBe(true);
  });

  it('adapter sequence 跳号事件 → 违约事件不投影 + 关闭（1011）', async () => {
    const harness = createHarness({ session: { emitSequenceGap: true } });
    harness.channel.handle(startMessage());
    await flush();
    // 第一条 partial(0) 合法投影；第二条 partial(2) 被序列验证器拒绝。
    expect(
      harness.events.filter((event) => event.type === 'partial'),
    ).toHaveLength(1);
    expect(harness.closes).toContain(1011);
    // 违约即终态：后续消息协议拒绝，chunk 不进入已死会话。
    harness.channel.handle(chunkMessage(1));
    expect(harness.protocolErrors).toBe(1);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(0);
  });

  it('adapter endpoint 后 partial → 违约事件不投影 + 关闭（1011）', async () => {
    const harness = createHarness({
      session: { emitPartialAfterEndpoint: true },
    });
    harness.channel.handle(startMessage());
    await flush();
    const types = harness.events.map((event) => event.type);
    expect(types).toContain('endpoint');
    // endpoint 后的 partial 被序列验证器拒绝。
    expect(
      harness.events.filter((event) => event.type === 'partial'),
    ).toHaveLength(0);
    expect(harness.closes).toContain(1011);
  });
});

describe('StreamingTranscriptionChannel 安全与架构边界', () => {
  it('测试17：日志只含受控标签与稳定 code/operationId/segmentId', async () => {
    const harness = createHarness({ createFailure: true });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.logs.length).toBeGreaterThan(0);
    for (const entry of harness.logs) {
      for (const key of Object.keys(entry)) {
        expect(['label', 'operationId', 'segmentId', 'code']).toContain(key);
      }
      expect(entry.label).toMatch(
        /^(session_started|session_ended|input_rejected|protocol_rejected|invalid_adapter_event|quota_exceeded)$/,
      );
      expect(entry.operationId).toBe('op:1');
      expect(entry.segmentId).toBe('seg:1');
    }
  });

  it('测试18：通道模块不依赖 Agent Loop / Turn 创建能力', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const channelSource = readFileSync(
      `${dir}/streaming-transcription-channel.ts`,
      'utf8',
    );
    const transportSource = readFileSync(
      `${dir}/streaming-transcription-ws-transport.ts`,
      'utf8',
    );
    const combined = `${channelSource}\n${transportSource}`;
    expect(combined).not.toMatch(/agent-runner/);
    expect(combined).not.toMatch(/GatewayService/);
    expect(combined).not.toMatch(/teaching-runtime/);
    expect(combined).not.toMatch(/agent-runtime/);
  });

  it('V13 O(1)：长会话无历史上限，序列验证仍按语义收敛', async () => {
    // V12 的历史记录上限（MAX_RECEIVED_MESSAGES）已由 O(1) 增量验证取代：
    // 不保存历史数组，长会话不再被防御性上限截断；chunk/字节配额由
    // maxChunksPerConnection / maxPcmBytesPerConnection 独立兜底。
    const harness = createHarness();
    harness.channel.handle(startMessage());
    for (let sequence = 1; sequence <= 2_000; sequence += 1) {
      harness.channel.handle(chunkMessage(sequence, sequence - 1));
    }
    harness.channel.handle(finishMessage(2_001));
    await flush();
    expect(harness.protocolErrors).toBe(0);
    expect(harness.closes).toEqual([]);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(2_000);
    expect(harness.events.map((event) => event.type)).toContain('final');
  });
});
