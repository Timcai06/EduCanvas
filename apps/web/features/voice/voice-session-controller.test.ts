import type {
  StreamingTranscriptionSegmentState,
  StreamingTranscriptionSnapshot,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import {
  AudioCaptureError,
  type AudioCaptureFailureCode,
} from './capture/capture-errors';
import type {
  AudioCapture,
  AudioPcmChunk,
  AudioCaptureState,
} from './capture/audio-capture';
import {
  StreamingTranscriptionClientError,
  type StreamingTranscriptionTerminalResult,
} from './transport';
import {
  VoiceSessionController,
  type VoiceSessionCaptureHandlers,
  type VoiceSessionClientHandlers,
  type VoiceSessionControllerDeps,
  type VoiceSessionErrorCode,
  type VoiceSessionLogEntry,
  type VoiceSessionStatus,
  type VoiceSessionTranscriptionClient,
} from './voice-session-controller';

// ── fake capture ──────────────────────────────────────────────────────────

class FakeCapture implements AudioCapture {
  state: AudioCaptureState = 'idle';
  startCalled = false;
  stopCalled = false;
  cancelCalled = false;
  cleanupCalled = false;
  startError: AudioCaptureError | null = null;
  startResult: { status: 'recording' } | { status: 'cancelled' } = {
    status: 'recording',
  };
  private handlers: VoiceSessionCaptureHandlers | null = null;
  private chunkSequence = 0;

  bind(handlers: VoiceSessionCaptureHandlers): void {
    this.handlers = handlers;
  }

  start(): Promise<{ status: 'recording' } | { status: 'cancelled' }> {
    this.startCalled = true;
    if (this.startError !== null) return Promise.reject(this.startError);
    return Promise.resolve(this.startResult);
  }

  stop(): void {
    this.stopCalled = true;
  }

  cancel(): void {
    this.cancelCalled = true;
  }

  cleanup(): void {
    this.cleanupCalled = true;
  }

  emitChunk(pcmBytes: Uint8Array): void {
    this.handlers?.onChunk({
      sequence: this.chunkSequence,
      pcmBytes,
    } satisfies AudioPcmChunk);
    this.chunkSequence += 1;
  }

  emitFailure(code: AudioCaptureFailureCode): void {
    this.handlers?.onFailure(code);
  }
}

// ── fake client ───────────────────────────────────────────────────────────

class FakeClient implements VoiceSessionTranscriptionClient {
  startCalled = false;
  finishCalled = false;
  cancelCalled = false;
  disconnectCalled = false;
  sentChunks: Uint8Array[] = [];
  startInput: { notebookId: string } | null = null;
  startError: StreamingTranscriptionClientError | null = null;
  private handlers: VoiceSessionClientHandlers | null = null;
  private gate: Promise<void> | null = null;
  private gateResolve: (() => void) | null = null;

  bind(handlers: VoiceSessionClientHandlers): void {
    this.handlers = handlers;
  }

  start(input: { notebookId: string; signal?: AbortSignal }): Promise<void> {
    this.startCalled = true;
    this.startInput = input;
    if (this.startError !== null) return Promise.reject(this.startError);
    if (this.gate !== null) return this.gate;
    return Promise.resolve();
  }

  sendChunk(pcmBytes: Uint8Array): void {
    this.sentChunks.push(pcmBytes);
  }

  finish(): void {
    this.finishCalled = true;
  }

  cancel(): void {
    this.cancelCalled = true;
  }

  disconnect(): void {
    this.disconnectCalled = true;
  }

  /** 测试驱动：让 start 挂起直到 releaseStart。 */
  gateStart(): void {
    this.gate = new Promise<void>((resolve) => {
      this.gateResolve = resolve;
    });
  }

  releaseStart(): void {
    this.gateResolve?.();
  }

  emitSnapshot(snapshot: StreamingTranscriptionSnapshot): void {
    this.handlers?.onSnapshot(snapshot);
  }

  emitTerminal(result: StreamingTranscriptionTerminalResult): void {
    this.handlers?.onTerminal(result);
  }
}

// ── harness ───────────────────────────────────────────────────────────────

interface HarnessCalls {
  partial: string[];
  final: string[];
  caption: string[];
  statuses: VoiceSessionStatus[];
  errors: VoiceSessionErrorCode[];
  logs: VoiceSessionLogEntry[];
}

interface Harness {
  controller: VoiceSessionController;
  capture: FakeCapture;
  client: FakeClient;
  calls: HarnessCalls;
  /** 形式化"零直接 Turn 调用"：控制器接口没有任何 Turn 提交面。 */
  turnSubmissions: () => number;
}

function makeHarness(
  overrides: Partial<VoiceSessionControllerDeps> = {},
): Harness {
  const capture = new FakeCapture();
  const client = new FakeClient();
  const calls: HarnessCalls = {
    partial: [],
    final: [],
    caption: [],
    statuses: [],
    errors: [],
    logs: [],
  };
  const controller = new VoiceSessionController({
    notebookId: 'nb-1',
    createCapture: (handlers) => {
      capture.bind(handlers);
      return capture;
    },
    createClient: (handlers) => {
      client.bind(handlers);
      return client;
    },
    onPartialText: (text) => calls.partial.push(text),
    onFinalText: (text) => calls.final.push(text),
    onStatusChange: (status) => calls.statuses.push(status),
    onError: (code) => calls.errors.push(code),
    log: (entry) => calls.logs.push(entry),
    ...overrides,
  });
  return {
    controller,
    capture,
    client,
    calls,
    turnSubmissions: () => calls.final.length + calls.caption.length,
  };
}

function segment(
  segmentId: string,
  status: 'active' | 'final' | 'failed',
  text: string,
): StreamingTranscriptionSegmentState {
  return {
    segmentId,
    status,
    text,
    failureCode: status === 'failed' ? 'UNKNOWN' : null,
    sequence: 0,
    endpointSeen: false,
    lastEventType:
      status === 'final' ? 'final' : status === 'failed' ? 'failed' : 'partial',
  };
}

function snapshot(
  operationId: string,
  segments: StreamingTranscriptionSegmentState[],
): StreamingTranscriptionSnapshot {
  return {
    operationId,
    segments,
    combinedText: segments
      .filter((s) => s.status !== 'failed' && s.text.length > 0)
      .map((s) => s.text)
      .join(' '),
  };
}

const PCM = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

describe('VoiceSessionController（Live Voice）', () => {
  it('start 完整交互：先建连接后启动采集，chunk 转发到 client', async () => {
    const harness = makeHarness();
    await harness.controller.start();

    expect(harness.client.startCalled).toBe(true);
    expect(harness.client.startInput).toEqual({ notebookId: 'nb-1' });
    expect(harness.capture.startCalled).toBe(true);
    expect(harness.calls.statuses.at(-1)).toBe('recording');

    harness.capture.emitChunk(PCM);
    expect(harness.client.sentChunks).toEqual([PCM]);
  });

  it('partial 连续修正：每次快照投影最新组合文本', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'active', '你好')]),
    );
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'active', '你好世界')]),
    );
    expect(harness.calls.partial).toEqual(['你好', '你好世界']);
  });

  it('stop 冲刷尾部后 finish，final 只回调一次并收敛 stopped', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.capture.emitChunk(PCM);
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'active', '你好世界')]),
    );

    harness.controller.stop();
    expect(harness.capture.stopCalled).toBe(true);
    expect(harness.client.finishCalled).toBe(true);
    expect(harness.calls.statuses.at(-1)).toBe('finalizing');

    harness.client.emitTerminal({ reason: 'final' });
    expect(harness.calls.final).toEqual(['你好世界']);
    expect(harness.calls.statuses.at(-1)).toBe('stopped');

    // 终态后重复事件被忽略：final 不重复回调。
    harness.client.emitTerminal({ reason: 'final' });
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'final', '你好世界')]),
    );
    expect(harness.calls.final).toEqual(['你好世界']);
    expect(harness.calls.statuses).toHaveLength(5); // starting/authorizing/recording/finalizing/stopped
  });

  it('final 只经组合回调进入现有 Turn', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.capture.emitChunk(PCM);
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'active', '你好世界')]),
    );
    harness.controller.stop();
    harness.client.emitTerminal({ reason: 'final' });
    // 控制器接口没有 Turn 提交面：final 只流向 onFinalText，绝不产生 Turn。
    expect(harness.calls.final).toEqual(['你好世界']);
    expect(harness.turnSubmissions()).toBe(1); // 1 次 final 交付 = 1 次 onFinalText
    expect(harness.client.sentChunks.length).toBeGreaterThan(0);
  });
});

describe('VoiceSessionController（失败与终态）', () => {
  it('断线（disconnected）→ CONNECTION_FAILED 并停止采集', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.client.emitTerminal({ reason: 'disconnected' });
    expect(harness.calls.statuses.at(-1)).toBe('failed');
    expect(harness.calls.errors).toEqual(['CONNECTION_FAILED']);
    expect(harness.capture.cancelCalled).toBe(true);
  });

  it('ticket 失败：failed/TICKET_FAILED，麦克风从未被请求', async () => {
    const capture = new FakeCapture();
    const createCapture = vi.fn((handlers: VoiceSessionCaptureHandlers) => {
      capture.bind(handlers);
      return capture;
    });
    const harness = makeHarness({ createCapture });
    harness.client.startError = new StreamingTranscriptionClientError(
      'TICKET_FAILED',
    );
    await harness.controller.start();
    expect(harness.calls.statuses.at(-1)).toBe('failed');
    expect(harness.calls.errors).toEqual(['TICKET_FAILED']);
    expect(createCapture).not.toHaveBeenCalled();
  });

  it('权限拒绝（capture 失败）：failed/PERMISSION_DENIED 并取消连接', async () => {
    const harness = makeHarness();
    harness.capture.startError = new AudioCaptureError('PERMISSION_DENIED');
    await harness.controller.start();
    expect(harness.calls.statuses.at(-1)).toBe('failed');
    expect(harness.calls.errors).toEqual(['PERMISSION_DENIED']);
    expect(harness.client.cancelCalled).toBe(true);
  });

  it('capture 异步失败（CONSUMER_FAILED）→ 取消连接并收敛 failed', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.capture.emitFailure('CONSUMER_FAILED');
    expect(harness.calls.statuses.at(-1)).toBe('failed');
    expect(harness.calls.errors).toEqual(['CONSUMER_FAILED']);
    expect(harness.client.cancelCalled).toBe(true);
  });

  it('模型失败（failed/MODEL_FAILED）→ MODEL_FAILED', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.client.emitTerminal({
      reason: 'failed',
      failureCode: 'MODEL_FAILED',
    });
    expect(harness.calls.errors).toEqual(['MODEL_FAILED']);
  });

  it('取消：丢弃 PCM、取消连接、本地收敛 cancelled；迟到事件忽略', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.capture.emitChunk(PCM);
    harness.controller.cancel();
    expect(harness.capture.cancelCalled).toBe(true);
    expect(harness.client.cancelCalled).toBe(true);
    expect(harness.calls.statuses.at(-1)).toBe('cancelled');
    // 迟到 final 被唯一终态守卫忽略。
    harness.client.emitTerminal({ reason: 'final' });
    expect(harness.calls.final).toEqual([]);
    expect(harness.calls.statuses.at(-1)).toBe('cancelled');
  });

  it('finalizing 中取消：不重复发 cancel（协议禁止），但必须 disconnect 释放连接', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.stop();
    harness.controller.cancel();
    expect(harness.client.cancelCalled).toBe(false);
    expect(harness.client.disconnectCalled).toBe(true);
    expect(harness.capture.cancelCalled).toBe(true);
    expect(harness.calls.statuses.at(-1)).toBe('cancelled');
  });

  it('唯一终态竞争：cancel 与 failed 先到先得，只收敛一次', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.cancel();
    harness.client.emitTerminal({ reason: 'failed', failureCode: 'UNKNOWN' });
    expect(harness.calls.statuses.at(-1)).toBe('cancelled');
    expect(harness.calls.errors).toEqual([]);
    expect(
      harness.calls.statuses.filter((s) => s === 'cancelled'),
    ).toHaveLength(1);
  });

  it('cancel/final/dispose 竞争：只收敛一个终态，final 不重复回调，清理幂等', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.capture.emitChunk(PCM);
    harness.controller.stop(); // finalizing
    harness.controller.cancel(); // 本地收敛 cancelled + disconnect
    harness.client.emitTerminal({ reason: 'final' }); // 迟到 final 被忽略
    harness.controller.dispose(); // 幂等清理
    expect(
      harness.calls.statuses.filter((s) => s === 'cancelled'),
    ).toHaveLength(1);
    expect(harness.calls.final).toEqual([]);
    expect(harness.calls.statuses.at(-1)).toBe('cancelled');
    expect(harness.client.disconnectCalled).toBe(true);
    // 再次 dispose 不抛、不产生新终态（无泄漏路径）。
    harness.controller.dispose();
    expect(
      harness.calls.statuses.filter((s) => s === 'cancelled'),
    ).toHaveLength(1);
  });

  it('final 后 dispose：终态保持 stopped，迟到 cancel 不改变终态', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.stop();
    harness.client.emitTerminal({ reason: 'final' });
    harness.controller.cancel();
    harness.controller.dispose();
    expect(harness.calls.statuses.at(-1)).toBe('stopped');
    expect(harness.calls.statuses.filter((s) => s === 'stopped')).toHaveLength(
      1,
    );
    expect(harness.client.disconnectCalled).toBe(true);
  });

  it('会话结束后再次 start 拒绝 INVALID_STATE', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.stop();
    harness.client.emitTerminal({ reason: 'final' });
    await harness.controller.start();
    expect(harness.calls.errors).toEqual(['INVALID_STATE']);
  });

  it('集成层工厂违约 → 稳定 UNKNOWN 失败', async () => {
    const harness = makeHarness({
      createClient: () => {
        throw new Error('bad wiring');
      },
    });
    await harness.controller.start();
    expect(harness.calls.statuses.at(-1)).toBe('failed');
    expect(harness.calls.errors).toEqual(['UNKNOWN']);
  });
});

describe('VoiceSessionController（dispose 与清理）', () => {
  it('client disconnect 抛错时仍释放 capture、引用并收敛 stopped', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.client.disconnect = () => {
      throw new Error('disconnect failure');
    };

    expect(() => harness.controller.dispose()).not.toThrow();
    expect(harness.capture.cleanupCalled).toBe(true);
    expect(harness.controller.getState()).toBe('stopped');
  });

  it('dispose 停止采集、断开连接、收敛一次且幂等', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.dispose();
    expect(harness.capture.cleanupCalled).toBe(true);
    expect(harness.client.disconnectCalled).toBe(true);
    expect(harness.calls.statuses.at(-1)).toBe('stopped');
    // 幂等：再次 dispose 不抛、不重复终态。
    harness.controller.dispose();
    expect(harness.calls.statuses.filter((s) => s === 'stopped')).toHaveLength(
      1,
    );
  });

  it('dispose 后事件全部忽略（唯一终态）', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.dispose();
    harness.client.emitTerminal({ reason: 'final' });
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'final', '迟到')]),
    );
    harness.controller.cancel();
    expect(harness.calls.final).toEqual([]);
    expect(harness.calls.partial).toEqual([]);
    expect(harness.calls.statuses.at(-1)).toBe('stopped');
  });

  it('连接挂起期间 dispose：client 断开，迟到的连接完成被忽略', async () => {
    const harness = makeHarness();
    harness.client.gateStart();
    const started = harness.controller.start();
    harness.controller.dispose();
    expect(harness.client.disconnectCalled).toBe(true);
    harness.client.releaseStart();
    await started;
    // 连接在 dispose 后才完成：不启动采集、状态仍为 stopped。
    expect(harness.capture.startCalled).toBe(false);
    expect(harness.calls.statuses.at(-1)).toBe('stopped');
  });

  it('连接或麦克风授权挂起期间 cancel：立即断开且迟到结果不能启动采集', async () => {
    const harness = makeHarness();
    harness.client.gateStart();
    const started = harness.controller.start();
    harness.controller.cancel();

    expect(harness.client.disconnectCalled).toBe(true);
    expect(harness.calls.statuses.at(-1)).toBe('cancelled');
    harness.client.releaseStart();
    await started;
    expect(harness.capture.startCalled).toBe(false);
  });
});

describe('VoiceSessionController（日志脱敏）', () => {
  it('日志不含 PCM、转录文本、ticket 或凭证', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.capture.emitChunk(PCM);
    harness.client.emitSnapshot(
      snapshot('op-1', [segment('seg-1', 'active', '敏感转录文本')]),
    );
    harness.controller.stop();
    harness.client.emitTerminal({ reason: 'final' });
    harness.controller.dispose();

    const serialized = JSON.stringify(harness.calls.logs);
    expect(serialized).not.toContain('3q2+7w=='); // PCM base64（0xde 0xad 0xbe 0xef）
    expect(serialized).not.toContain('敏感转录文本');
    expect(serialized).not.toContain('ticket');
    expect(serialized).not.toContain('bearer');
    expect(serialized).not.toContain('Error');
    for (const entry of harness.calls.logs) {
      expect(entry.label).toMatch(
        /^(session_started|chunk_forwarded|final_delivered|segment_final_appended|session_stopped|session_cancelled|session_failed|capture_failed|disposed)$/,
      );
    }
  });

  it('错误只暴露稳定码', async () => {
    const harness = makeHarness();
    harness.capture.startError = new AudioCaptureError('PERMISSION_DENIED');
    await harness.controller.start();
    expect(harness.calls.errors).toEqual(['PERMISSION_DENIED']);
    expect(harness.calls.logs.some((e) => e.label === 'session_failed')).toBe(
      true,
    );
    // 日志条目只含受控键（label 必有，code 仅错误类条目）。
    for (const entry of harness.calls.logs) {
      const keys = Object.keys(entry).sort();
      expect(keys).toEqual(
        keys.includes('code') ? ['code', 'label'] : ['label'],
      );
    }
  });
});

describe('VoiceSessionController（状态机健全性）', () => {
  it('notebookId 正确传给 client（会话归属）', async () => {
    const harness = makeHarness({ notebookId: 'nb-42' });
    await harness.controller.start();
    expect(harness.client.startInput).toEqual({ notebookId: 'nb-42' });
  });

  it('onStatusChange 按序投影阶段', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    harness.controller.stop();
    harness.client.emitTerminal({ reason: 'final' });
    expect(harness.calls.statuses).toEqual([
      'starting',
      'authorizing',
      'recording',
      'finalizing',
      'stopped',
    ]);
  });

  it('start 期间 factory 只调用一次（引用可清理）', async () => {
    const captureFactory = vi
      .fn()
      .mockImplementation((handlers: VoiceSessionCaptureHandlers) => {
        const fake = new FakeCapture();
        fake.bind(handlers);
        return fake;
      });
    const harness = makeHarness({
      createCapture: captureFactory,
    });
    await harness.controller.start();
    expect(captureFactory).toHaveBeenCalledTimes(1);
  });
});
