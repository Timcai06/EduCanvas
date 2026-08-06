/**
 * V13 通道级配额测试 — chunk/字节上限、输入/输出背压、duration/idle
 * deadline。全部使用 fake clock / 注入配额 / fake session，不依赖固定
 * sleep；deadline 由注入计时器手动推进验证。
 */

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
import { STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS } from './streaming-transcription-quotas';
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

/** 注入式 fake clock：计时器只由 advance() 手动触发，不依赖真实时间。 */
function createFakeClock() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<
    number,
    { at: number; callback: () => void; cancelled: boolean }
  >();
  return {
    now: () => now,
    scheduleTimer: (callback: () => void, ms: number): number => {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { at: now + ms, callback, cancelled: false });
      return handle;
    },
    clearTimer: (handle: unknown): void => {
      const timer = timers.get(handle as number);
      if (timer !== undefined) timer.cancelled = true;
    },
    /** 推进时钟并触发所有到期（未取消）计时器。 */
    advance(ms: number): void {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => !timer.cancelled && timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [handle, timer] of due) {
        if (timer.cancelled) continue;
        timer.cancelled = true; // 一次性：触发后即失效
        timer.callback();
      }
    },
  };
}

interface Harness {
  channel: StreamingTranscriptionChannel;
  gateway: FakeTranscriptionGateway;
  events: StreamingTranscriptionServerMessage[];
  protocolErrors: number;
  closes: Array<1008 | 1011>;
  quotaErrors: string[];
  terminalReasons: string[];
  sessionLeaseReleases: number;
  logs: StreamingTranscriptionChannelLogEntry[];
}

function createHarness(
  options: {
    quotas?: Partial<typeof STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS>;
    clock?: ReturnType<typeof createFakeClock>;
    gatewayConfig?: ConstructorParameters<typeof FakeTranscriptionGateway>[0];
    /** 注入 session lease 行为：null 表示超限，否则记录 release 次数。 */
    sessionLease?: 'grant' | 'deny' | 'none';
  } = {},
): Harness {
  const gateway = new FakeTranscriptionGateway(options.gatewayConfig);
  const events: StreamingTranscriptionServerMessage[] = [];
  let protocolErrors = 0;
  const closes: Array<1008 | 1011> = [];
  const quotaErrors: string[] = [];
  const terminalReasons: string[] = [];
  let sessionLeaseReleases = 0;
  const logs: StreamingTranscriptionChannelLogEntry[] = [];
  const channel = new StreamingTranscriptionChannel({
    gateway,
    createTraceId: () => 'trace:test',
    quotas: {
      ...STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
      ...options.quotas,
    },
    now: options.clock?.now,
    scheduleTimer: options.clock?.scheduleTimer,
    clearTimer: options.clock?.clearTimer,
    acquireSession: (() => {
      if (options.sessionLease === 'none') return undefined;
      if (options.sessionLease === 'deny') return () => null;
      return () => ({
        released: false,
        release: () => {
          sessionLeaseReleases += 1;
        },
      });
    })(),
    sendEvent: (event) => events.push(event),
    sendProtocolError: () => {
      protocolErrors += 1;
    },
    sendQuotaError: (code) => quotaErrors.push(code),
    onTerminal: (reason) => terminalReasons.push(reason),
    close: (code) => closes.push(code),
    log: (entry) => logs.push(entry),
  });
  return {
    channel,
    gateway,
    events,
    closes,
    quotaErrors,
    terminalReasons,
    logs,
    get sessionLeaseReleases() {
      return sessionLeaseReleases;
    },
    get protocolErrors() {
      return protocolErrors;
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('StreamingTranscriptionChannel V13 输入配额', () => {
  it('chunk 数恰好到上限正常，之后 finish 正常收 final', async () => {
    const harness = createHarness({ quotas: { maxChunksPerConnection: 2 } });
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1, 0));
    harness.channel.handle(chunkMessage(2, 1));
    await flush();
    expect(harness.quotaErrors).toEqual([]);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(2);
    harness.channel.handle(finishMessage(3));
    await flush();
    expect(harness.events.map((event) => event.type)).toContain('final');
  });

  it('超过 chunk 上限稳定失败：错误码 + abort + close，不再转发', async () => {
    const harness = createHarness({ quotas: { maxChunksPerConnection: 2 } });
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1, 0));
    harness.channel.handle(chunkMessage(2, 1));
    harness.channel.handle(chunkMessage(3, 2)); // 第 3 片超限
    expect(harness.quotaErrors).toContain('INPUT_CHUNK_LIMIT_EXCEEDED');
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(2);
    await flush();
    // 连接错误面 = 错误帧 + close；会话侧唯一终态由 abort 收敛（CANCELLED），
    // 但不再投影给客户端（配额违约不投影第二个事件流终态）。
    const terminal = harness.gateway.sessions[0]!.terminalEvent;
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.failureCode).toBe('CANCELLED');
    }
    expect(
      harness.logs.some(
        (entry) =>
          entry.label === 'quota_exceeded' &&
          entry.code === 'INPUT_CHUNK_LIMIT_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('累计 PCM 字节恰好到上限正常', async () => {
    // VALID_PCM_BYTES 4 字节；上限 8 = 恰好 2 片。
    const harness = createHarness({
      quotas: { maxPcmBytesPerConnection: 8 },
    });
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1, 0));
    harness.channel.handle(chunkMessage(2, 1));
    await flush();
    expect(harness.quotaErrors).toEqual([]);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(2);
  });

  it('超过累计 PCM 字节上限稳定失败', async () => {
    const harness = createHarness({
      quotas: { maxPcmBytesPerConnection: 8 },
    });
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1, 0));
    harness.channel.handle(chunkMessage(2, 1));
    harness.channel.handle(chunkMessage(3, 2)); // 累计 12 字节 > 8
    expect(harness.quotaErrors).toContain('INPUT_BYTE_LIMIT_EXCEEDED');
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(2);
  });
});

describe('StreamingTranscriptionChannel V13 背压', () => {
  it('输入队列达到上限触发背压：不处理积压消息、稳定失败', async () => {
    const harness = createHarness({ quotas: { maxQueuedInputMessages: 1 } });
    harness.channel.enqueue(startMessage()); // 入队并调度 drain（微任务未跑）
    // 同一批次内第二条消息到达：队列已满 → 背压失败，start 不被处理。
    harness.channel.enqueue(chunkMessage(1));
    expect(harness.quotaErrors).toContain('INPUT_BACKPRESSURE_EXCEEDED');
    expect(harness.closes).toContain(1008);
    await flush();
    expect(harness.gateway.beginCalls).toBe(0);
    expect(harness.gateway.sessions).toHaveLength(0);
  });

  it('正常 enqueue 路径与 handle 等价（消息在微任务内被处理）', async () => {
    const harness = createHarness();
    harness.channel.enqueue(startMessage());
    harness.channel.enqueue(chunkMessage(1));
    harness.channel.enqueue(finishMessage(2));
    await flush();
    expect(harness.quotaErrors).toEqual([]);
    expect(harness.gateway.sessions).toHaveLength(1);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(1);
    expect(harness.events.map((event) => event.type)).toContain('final');
  });

  it('输出背压超限（transport 报告）稳定失败并清理', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.outputBackpressureExceeded();
    expect(harness.quotaErrors).toContain('OUTPUT_BACKPRESSURE_EXCEEDED');
    expect(harness.closes).toContain(1008);
    await flush();
    // 会话侧唯一终态由 abort 收敛；错误帧即连接错误面。
    const terminal = harness.gateway.sessions[0]!.terminalEvent;
    if (terminal?.type === 'failed') {
      expect(terminal.failureCode).toBe('CANCELLED');
    }
    // 终态后消息不再被接受。
    harness.channel.handle(chunkMessage(1));
    expect(harness.protocolErrors).toBe(1);
  });
});

describe('StreamingTranscriptionChannel V13 deadline', () => {
  it('idle 超时：abort + 稳定错误码 + close + 清理', async () => {
    const clock = createFakeClock();
    const harness = createHarness({
      quotas: { maxSessionIdleMs: 5_000, maxSessionDurationMs: 60_000 },
      clock,
    });
    harness.channel.handle(startMessage());
    await flush();
    clock.advance(5_001);
    await flush();
    expect(harness.quotaErrors).toContain('SESSION_IDLE_TIMEOUT');
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
    // 会话侧唯一终态由 abort 收敛（错误帧即连接错误面，不再投影事件）。
    const terminal = harness.gateway.sessions[0]!.terminalEvent;
    if (terminal?.type === 'failed') {
      expect(terminal.failureCode).toBe('CANCELLED');
    }
    // 终态后推进大量时间不再触发任何 deadline（计时器已清理）。
    clock.advance(600_000);
    expect(harness.quotaErrors).toHaveLength(1);
  });

  it('合法消息重置 idle：持续活动不触发 idle 超时', async () => {
    const clock = createFakeClock();
    const harness = createHarness({
      quotas: { maxSessionIdleMs: 5_000, maxSessionDurationMs: 60_000 },
      clock,
    });
    harness.channel.handle(startMessage());
    clock.advance(4_999);
    harness.channel.handle(chunkMessage(1, 0)); // 重置 idle
    clock.advance(4_999);
    harness.channel.handle(chunkMessage(2, 1)); // 再次重置
    clock.advance(4_999);
    await flush();
    expect(harness.quotaErrors).toEqual([]);
    expect(harness.gateway.sessions[0]!.pushedChunks).toHaveLength(2);
  });

  it('duration 超时：持续活动下由 duration 兜底，稳定失败', async () => {
    const clock = createFakeClock();
    const harness = createHarness({
      quotas: { maxSessionIdleMs: 5_000, maxSessionDurationMs: 10_000 },
      clock,
    });
    harness.channel.handle(startMessage());
    clock.advance(4_999);
    harness.channel.handle(chunkMessage(1, 0)); // idle 重置
    clock.advance(4_999);
    harness.channel.handle(chunkMessage(2, 1)); // idle 重置
    clock.advance(2); // duration（t=10_000）到期，idle（t=14_998）未到期
    await flush();
    expect(harness.quotaErrors).toContain('SESSION_DURATION_EXCEEDED');
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
  });

  it('awaiting-start 阶段 idle 超时：只发错误帧 + close（无 Session 可 abort）', () => {
    const clock = createFakeClock();
    const harness = createHarness({
      quotas: { maxSessionIdleMs: 5_000, maxSessionDurationMs: 60_000 },
      clock,
    });
    clock.advance(5_001); // 从不发 start：idle（连接级，从建立起算）到期
    expect(harness.quotaErrors).toContain('SESSION_IDLE_TIMEOUT');
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.beginCalls).toBe(0);
  });

  it('finish 正常终态后计时器清理：不再触发任何 quota', async () => {
    const clock = createFakeClock();
    const harness = createHarness({
      quotas: { maxSessionIdleMs: 5_000, maxSessionDurationMs: 10_000 },
      clock,
    });
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    await flush();
    expect(harness.events.map((event) => event.type)).toContain('final');
    clock.advance(1_000_000);
    expect(harness.quotaErrors).toEqual([]);
    expect(harness.closes).toEqual([]);
  });
});

describe('StreamingTranscriptionChannel V13 REVISE 终态收敛', () => {
  it('finish → final 投影后 onTerminal 触发一次 terminal-event', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    await flush();
    expect(harness.events.some((event) => event.type === 'final')).toBe(true);
    expect(harness.terminalReasons).toEqual(['terminal-event']);
  });

  it('cancel → failed 终态后 onTerminal 触发一次 terminal-event', async () => {
    const harness = createHarness();
    harness.channel.handle(startMessage());
    harness.channel.handle(cancelMessage(1));
    await flush();
    expect(
      harness.events.some(
        (event) => event.type === 'failed' && event.failureCode === 'CANCELLED',
      ),
    ).toBe(true);
    expect(harness.terminalReasons).toEqual(['terminal-event']);
  });

  it('adapter schema 非法事件 → abort recognizer + adapter-violation（只一次）', async () => {
    const harness = createHarness({
      gatewayConfig: { session: { emitInvalidEvent: true } },
    });
    harness.channel.handle(startMessage());
    await flush();
    // REVISE：违约必须 abort 底层 Session/recognizer，不能只关连接。
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
    expect(harness.closes).toContain(1011);
    expect(harness.terminalReasons).toEqual(['adapter-violation']);
  });

  it('adapter 双终态 → 违约审计；关闭码由首个终态决定', async () => {
    const harness = createHarness({
      gatewayConfig: { session: { emitDoubleTerminal: true } },
    });
    harness.channel.handle(startMessage());
    await flush();
    // 首个 final 验证并投影后即锁终态（无活跃 recognizer 可取消，abort 为
    // no-op）；后续违约仍被审计（close 1011 + invalid_adapter_event），但
    // 不再覆盖首个终态通知（REVISE：Adapter 后续违约审计独立于关闭码）。
    expect(harness.gateway.sessions[0]!.terminalEvent?.type).toBe('final');
    expect(harness.closes).toContain(1011);
    expect(harness.terminalReasons).toEqual(['terminal-event']);
    expect(
      harness.logs.some((entry) => entry.label === 'invalid_adapter_event'),
    ).toBe(true);
  });

  it('事件流无终态直接结束 → 违约：abort + 1011 + adapter-violation', async () => {
    const harness = createHarness({
      gatewayConfig: { session: { endWithoutTerminal: true } },
    });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
    expect(harness.closes).toContain(1011);
    expect(harness.terminalReasons).toEqual(['adapter-violation']);
    expect(
      harness.logs.some((entry) => entry.label === 'invalid_adapter_event'),
    ).toBe(true);
  });

  it('事件迭代器异常 → 违约：abort + 1011 + adapter-violation', async () => {
    const harness = createHarness({
      gatewayConfig: { session: { throwOnIterate: true } },
    });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
    expect(harness.closes).toContain(1011);
    expect(harness.terminalReasons).toEqual(['adapter-violation']);
  });

  it('配额违约 → onTerminal quota-exceeded 一次', () => {
    const harness = createHarness({ quotas: { maxChunksPerConnection: 1 } });
    harness.channel.handle(startMessage());
    harness.channel.handle(chunkMessage(1, 0));
    harness.channel.handle(chunkMessage(2, 1)); // 超限
    expect(harness.terminalReasons).toEqual(['quota-exceeded']);
    expect(harness.closes).toContain(1008);
  });
});

describe('StreamingTranscriptionChannel V13 REVISE 第二轮：Session 租约', () => {
  it('finish 终态形成后 session lease 恰释放一次（不等连接关闭）', async () => {
    const harness = createHarness({ sessionLease: 'grant' });
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    await flush();
    expect(harness.events.some((event) => event.type === 'final')).toBe(true);
    expect(harness.sessionLeaseReleases).toBe(1);
    // 再次 handle（终态后消息）不重复释放（幂等）。
    harness.channel.handle(chunkMessage(2));
    expect(harness.sessionLeaseReleases).toBe(1);
  });

  it('adapter 违约（非法事件）后 session lease 释放', async () => {
    const harness = createHarness({
      sessionLease: 'grant',
      gatewayConfig: { session: { emitInvalidEvent: true } },
    });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.gateway.sessions[0]!.aborted).toBe(true);
    expect(harness.sessionLeaseReleases).toBe(1);
  });

  it('事件流无终态结束（adapter 违约）后 session lease 释放', async () => {
    const harness = createHarness({
      sessionLease: 'grant',
      gatewayConfig: { session: { endWithoutTerminal: true } },
    });
    harness.channel.handle(startMessage());
    await flush();
    expect(harness.sessionLeaseReleases).toBe(1);
    expect(harness.closes).toContain(1011);
  });

  it('事件迭代器挂起（终态后不结束）session lease 仍在终态释放', async () => {
    const harness = createHarness({
      sessionLease: 'grant',
      gatewayConfig: { session: { hangAfterTerminal: true } },
    });
    harness.channel.handle(startMessage());
    harness.channel.handle(finishMessage(1));
    await flush();
    expect(harness.events.some((event) => event.type === 'final')).toBe(true);
    // 终态投影即释放，不依赖迭代器自觉结束。
    expect(harness.sessionLeaseReleases).toBe(1);
    expect(harness.terminalReasons).toEqual(['terminal-event']);
  });

  it('Session/recognizer 槽超限：不创建 recognizer，稳定失败', () => {
    const harness = createHarness({ sessionLease: 'deny' });
    harness.channel.handle(startMessage());
    expect(harness.quotaErrors).toContain('SESSION_LIMIT_EXCEEDED');
    expect(harness.closes).toContain(1008);
    expect(harness.gateway.beginCalls).toBe(0);
    expect(harness.terminalReasons).toEqual(['quota-exceeded']);
  });
});
