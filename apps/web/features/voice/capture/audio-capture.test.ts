import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PCM_CHUNK_BYTES } from '@educanvas/agent-core';
import { AudioCaptureError } from './capture-errors';
import {
  createAudioCapture,
  DEFAULT_CHUNK_BYTES,
  type AudioCapture,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioPcmChunk,
  type AudioSampleBufferLike,
  type MediaDevicesLike,
  type MediaStreamLike,
  type MediaStreamTrackLike,
  type ScriptProcessorNodeLike,
} from './audio-capture';
import type { AudioCaptureFailureCode } from './capture-errors';

function filled(length: number, value: number): Float32Array {
  return new Float32Array(length).fill(value);
}

// ── fake 浏览器 API（全部记录调用以便断言清理证据）───────────────────

class FakeTrack implements MediaStreamTrackLike {
  stopCalls = 0;
  stop(): void {
    this.stopCalls += 1;
  }
}

class FakeStream implements MediaStreamLike {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): MediaStreamTrackLike[] {
    return this.tracks;
  }
}

class FakeSampleBuffer implements AudioSampleBufferLike {
  readonly numberOfChannels: number;
  constructor(readonly channels: Float32Array[]) {
    this.numberOfChannels = channels.length;
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

class FakeNode implements AudioNodeLike {
  disconnectCalls = 0;
  connect(): unknown {
    return undefined;
  }
  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakeScriptProcessor extends FakeNode implements ScriptProcessorNodeLike {
  onaudioprocess:
    ((event: { inputBuffer: AudioSampleBufferLike }) => void) | null = null;
}

class FakeAudioContext implements AudioContextLike {
  readonly destination = new FakeNode();
  readonly sourceNodes: FakeNode[] = [];
  readonly processors: FakeScriptProcessor[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  /** 非空时 resume 返回挂起 promise，由测试手动 resolve（竞争时序用）。 */
  resumeGate: { resolve: () => void } | null = null;
  constructor(
    readonly sampleRate: number,
    public state: 'suspended' | 'running' | 'closed' = 'running',
  ) {}
  createMediaStreamSource(): AudioNodeLike {
    const node = new FakeNode();
    this.sourceNodes.push(node);
    return node;
  }
  createScriptProcessor(): ScriptProcessorNodeLike {
    const processor = new FakeScriptProcessor();
    this.processors.push(processor);
    return processor;
  }
  createGain(): AudioNodeLike {
    return new FakeNode();
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeGate !== null) {
      return new Promise<void>((resolve) => {
        this.resumeGate!.resolve = resolve;
      });
    }
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

class FakeMediaDevices implements MediaDevicesLike {
  getUserMediaCalls = 0;
  streams: FakeStream[] = [];
  error: Error | null = null;
  /** 非空时 getUserMedia 返回挂起 promise，由测试手动 resolve（竞争时序用）。 */
  gate: { resolve: (stream: MediaStreamLike) => void } | null = null;
  async getUserMedia(): Promise<MediaStreamLike> {
    this.getUserMediaCalls += 1;
    if (this.error !== null) throw this.error;
    const stream = new FakeStream([new FakeTrack()]);
    this.streams.push(stream);
    if (this.gate !== null) {
      return new Promise<MediaStreamLike>((resolve) => {
        this.gate!.resolve = resolve;
      });
    }
    return stream;
  }
}

interface Harness {
  capture: AudioCapture;
  devices: FakeMediaDevices;
  context: FakeAudioContext;
  chunks: AudioPcmChunk[];
  failures: AudioCaptureFailureCode[];
  fire: (channels: Float32Array[]) => void;
}

interface HarnessOptions {
  sampleRate?: number;
  contextState?: 'suspended' | 'running' | 'closed';
  chunkBytes?: number;
  devices?: FakeMediaDevices;
  audioContextFactory?: () => AudioContextLike;
  onChunk?: (chunk: AudioPcmChunk) => void;
  autoStart?: boolean;
}

async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const devices = options.devices ?? new FakeMediaDevices();
  const context = new FakeAudioContext(
    options.sampleRate ?? 16000,
    options.contextState ?? 'running',
  );
  const chunks: AudioPcmChunk[] = [];
  const failures: AudioCaptureFailureCode[] = [];
  const capture = createAudioCapture(
    {
      mediaDevices: devices,
      audioContextFactory: options.audioContextFactory ?? (() => context),
      onChunk: options.onChunk ?? ((chunk) => void chunks.push(chunk)),
      onFailure: (code) => void failures.push(code),
    },
    options.chunkBytes === undefined
      ? undefined
      : { chunkBytes: options.chunkBytes },
  );
  if (options.autoStart ?? true) {
    await capture.start();
  }
  const processor = context.processors[0];
  return {
    capture,
    devices,
    context,
    chunks,
    failures,
    fire: (channels: Float32Array[]) => {
      processor?.onaudioprocess?.({
        inputBuffer: new FakeSampleBuffer(channels),
      });
    },
  };
}

/** 从 PCM16LE 字节对还原 int16 值（测试断言用，需符号扩展）。 */
function readInt16Le(bytes: Uint8Array, index: number): number {
  const lo = bytes[index * 2]!;
  const hi = bytes[index * 2 + 1]!;
  return ((lo | (hi << 8)) << 16) >> 16;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 采集与重采样集成（16k/44.1k/48k + 双声道）────────────────────────

describe('采集路径：任意采样率确定性转换到 16k mono', () => {
  it('16k 输入直通：1600 样本 → 两个 1600 字节 chunk', async () => {
    const h = await makeHarness();
    // 直通路径每块末尾延迟 1 个样本到下一块，故喂 1601 个输入
    // （延迟样本在 stop 时冲刷，见 stop 测试）。
    h.fire([filled(1601, 0.5)]);
    expect(h.chunks).toHaveLength(2);
    expect(h.chunks[0]!.pcmBytes.length).toBe(1600);
    expect(h.chunks[1]!.pcmBytes.length).toBe(1600);
    // 0.5 → 16384 → LE [0x00, 0x40]
    expect(h.chunks[0]!.pcmBytes[0]).toBe(0x00);
    expect(h.chunks[0]!.pcmBytes[1]).toBe(0x40);
  });

  it('44.1k → 16k：4410 输入样本恰好两个 1600 字节 chunk', async () => {
    const h = await makeHarness({ sampleRate: 44100 });
    h.fire([filled(4410, 0.5)]);
    expect(h.chunks).toHaveLength(2);
    expect(h.chunks[0]!.pcmBytes.length).toBe(1600);
    expect(readInt16Le(h.chunks[0]!.pcmBytes, 0)).toBe(16384);
  });

  it('48k → 16k：4800 输入样本恰好两个 1600 字节 chunk', async () => {
    const h = await makeHarness({ sampleRate: 48000 });
    h.fire([filled(4800, 0.5)]);
    expect(h.chunks).toHaveLength(2);
    expect(h.chunks[0]!.pcmBytes.length).toBe(1600);
    expect(readInt16Le(h.chunks[0]!.pcmBytes, 0)).toBe(16384);
  });

  it('双声道输入正确归并为 mono 平均值（0.2/0.4 → 0.3）', async () => {
    const h = await makeHarness();
    h.fire([filled(1601, 0.2), filled(1601, 0.4)]);
    expect(h.chunks).toHaveLength(2);
    // mono 0.3 → round(0.3*32768) = 9830 → LE [0x66, 0x26]
    expect(readInt16Le(h.chunks[0]!.pcmBytes, 0)).toBe(9830);
    expect(h.chunks[0]!.pcmBytes[0]).toBe(0x66);
    expect(h.chunks[0]!.pcmBytes[1]).toBe(0x26);
  });

  it('单声道输入（numberOfChannels=1）也正常交付', async () => {
    const h = await makeHarness();
    h.fire([filled(1601, -1)]);
    expect(h.chunks).toHaveLength(2);
    expect(readInt16Le(h.chunks[0]!.pcmBytes, 0)).toBe(-32768);
  });
});

// ── chunk 契约：sequence、大小、非空、偶数字节、上限 ───────────────

describe('PCM chunk 契约（V16 必测）', () => {
  it('sequence 从 0 连续递增，多个块大小固定为 chunkBytes', async () => {
    const h = await makeHarness({ chunkBytes: 64 });
    h.fire([filled(101, 0.1)]);
    h.fire([filled(60, 0.1)]);
    // 161 输入（16k 直通，含块间延迟）→ 160 输出 → 5 个满块（32 样本/块）。
    expect(h.chunks.map((c) => c.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(h.chunks.every((c) => c.pcmBytes.length === 64)).toBe(true);
  });

  it('每个 chunk 非空且字节数为偶数', async () => {
    const h = await makeHarness({ chunkBytes: 64 });
    h.fire([filled(32, 0.1)]);
    h.fire([filled(33, 0.1)]);
    for (const chunk of h.chunks) {
      expect(chunk.pcmBytes.length).toBeGreaterThan(0);
      expect(chunk.pcmBytes.length % 2).toBe(0);
    }
  });

  it('chunk 不超过 V04 MAX_PCM_CHUNK_BYTES；等于上限合法', async () => {
    const h = await makeHarness({ chunkBytes: MAX_PCM_CHUNK_BYTES });
    h.fire([filled(16001, 0.1)]);
    expect(h.chunks).toHaveLength(1);
    expect(h.chunks[0]!.pcmBytes.length).toBe(MAX_PCM_CHUNK_BYTES);
  });

  it('非法 chunkBytes 在构造时以稳定码拒绝', () => {
    const deps = {
      mediaDevices: new FakeMediaDevices(),
      audioContextFactory: () => new FakeAudioContext(16000),
      onChunk: () => undefined,
    };
    for (const bad of [0, 1, 3, MAX_PCM_CHUNK_BYTES + 2, -8]) {
      expect(() => createAudioCapture(deps, { chunkBytes: bad })).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTIONS' }),
      );
    }
  });
});

// ── stop / cancel：尾部处理与幂等 ──────────────────────────────────

describe('stop/cancel（V16 必测）', () => {
  it('stop 把剩余样本作为最后一个 chunk 合法交付', async () => {
    const h = await makeHarness({ chunkBytes: 64 });
    h.fire([filled(40, 0.1)]); // 1 满块（32）+ 8 剩余
    expect(h.chunks).toHaveLength(1);
    h.capture.stop();
    // 尾部 8 样本 → 16 字节 chunk，sequence 连续。
    expect(h.chunks).toHaveLength(2);
    expect(h.chunks[1]!.sequence).toBe(1);
    expect(h.chunks[1]!.pcmBytes.length).toBe(16);
    expect(h.capture.state).toBe('stopped');
    // 资源已清理。
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    expect(h.context.closeCalls).toBe(1);
  });

  it('cancel 丢弃未提交尾部且不再交付新 PCM', async () => {
    const h = await makeHarness({ chunkBytes: 64 });
    h.fire([filled(40, 0.1)]); // 1 满块 + 8 剩余
    expect(h.chunks).toHaveLength(1);
    h.capture.cancel();
    expect(h.capture.state).toBe('cancelled');
    expect(h.chunks).toHaveLength(1); // 剩余 8 样本被丢弃
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    // cancel 后 feed 不再产生新 chunk（已清理）。
    h.fire([filled(64, 0.1)]);
    expect(h.chunks).toHaveLength(1);
  });

  it('stop/cancel/cleanup 全部幂等（重复清理，V16 必测）', async () => {
    const h = await makeHarness();
    h.capture.stop();
    h.capture.stop();
    h.capture.cancel();
    h.capture.cleanup();
    h.capture.cleanup();
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    expect(h.context.closeCalls).toBe(1);
    expect(h.capture.state).toBe('stopped');
  });

  it('cancel 后 cleanup 保持 cancelled 终态', async () => {
    const h = await makeHarness();
    h.capture.cancel();
    h.capture.cleanup();
    expect(h.capture.state).toBe('cancelled');
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
  });

  it('idle 时 stop/cancel 收敛终态且无副作用', async () => {
    const h = await makeHarness({ autoStart: false });
    h.capture.stop();
    expect(h.capture.state).toBe('stopped');
    const h2 = await makeHarness({ autoStart: false });
    h2.capture.cancel();
    expect(h2.capture.state).toBe('cancelled');
  });

  it('stop 后再次 start 以 INVALID_STATE 拒绝', async () => {
    const h = await makeHarness();
    h.capture.stop();
    await expect(h.capture.start()).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});

// ── 失败路径：稳定错误码与清理 ─────────────────────────────────────

describe('失败路径（V16 必测）', () => {
  it('权限拒绝 → PERMISSION_DENIED', async () => {
    const devices = new FakeMediaDevices();
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    devices.error = denied;
    const h = await makeHarness({ devices, autoStart: false });
    await expect(h.capture.start()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(h.capture.state).toBe('failed');
    expect(h.failures).toEqual(['PERMISSION_DENIED']);
  });

  it('无输入设备 → NO_AUDIO_INPUT', async () => {
    const devices = new FakeMediaDevices();
    const notFound = new Error('not found');
    notFound.name = 'NotFoundError';
    devices.error = notFound;
    const h = await makeHarness({ devices, autoStart: false });
    await expect(h.capture.start()).rejects.toMatchObject({
      code: 'NO_AUDIO_INPUT',
    });
    expect(h.failures).toEqual(['NO_AUDIO_INPUT']);
  });

  it('其他 getUserMedia 错误 → CAPTURE_FAILED（不泄露原始异常）', async () => {
    const devices = new FakeMediaDevices();
    const other = new Error('原始浏览器内部细节 message');
    other.name = 'SecurityError';
    devices.error = other;
    const h = await makeHarness({ devices, autoStart: false });
    await expect(h.capture.start()).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
    // 稳定码不含原始 message/name。
    expect(h.failures).toEqual(['CAPTURE_FAILED']);
  });

  it('AudioContext 工厂抛错 → AUDIO_CONTEXT_FAILED 且已获取的 track 被清理', async () => {
    const devices = new FakeMediaDevices();
    const h = await makeHarness({
      devices,
      autoStart: false,
      audioContextFactory: () => {
        throw new Error('boom');
      },
    });
    await expect(h.capture.start()).rejects.toMatchObject({
      code: 'AUDIO_CONTEXT_FAILED',
    });
    expect(h.capture.state).toBe('failed');
    // getUserMedia 已拿到流，失败后必须停 track。
    expect(devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
  });

  it('resume 失败 → AUDIO_CONTEXT_FAILED 且清理', async () => {
    const context = new FakeAudioContext(16000, 'suspended');
    context.resume = () => Promise.reject(new Error('resume boom'));
    const devices = new FakeMediaDevices();
    const h = await makeHarness({
      devices,
      autoStart: false,
      audioContextFactory: () => context,
    });
    await expect(h.capture.start()).rejects.toMatchObject({
      code: 'AUDIO_CONTEXT_FAILED',
    });
    expect(devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
  });

  it('consumer 抛错 → CONSUMER_FAILED、进入 failed、资源清理、停止交付', async () => {
    let calls = 0;
    const h = await makeHarness({
      onChunk: () => {
        calls += 1;
        if (calls === 2) throw new Error('consumer boom');
      },
    });
    h.fire([filled(1600, 0.1)]); // 1 满块（延迟样本在下一块）
    expect(h.capture.state).toBe('recording');
    h.fire([filled(1601, 0.1)]); // 第二次交付抛错
    expect(h.capture.state).toBe('failed');
    expect(h.failures).toEqual(['CONSUMER_FAILED']);
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    expect(h.context.closeCalls).toBe(1);
    const delivered = h.chunks.length;
    h.fire([filled(1600, 0.1)]);
    expect(h.chunks.length).toBe(delivered); // 不再交付
  });

  it('consumer 抛错后的 stop/cancel 不再触发重复清理', async () => {
    const h = await makeHarness({
      onChunk: () => {
        throw new Error('boom');
      },
    });
    h.fire([filled(1601, 0.1)]);
    expect(h.capture.state).toBe('failed');
    h.capture.stop();
    h.capture.cancel();
    h.capture.cleanup();
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    expect(h.context.closeCalls).toBe(1);
  });

  it('consumer 抛错后不再交付新 PCM（失败路径清理完备）', async () => {
    let delivered = 0;
    const h = await makeHarness({
      onChunk: () => {
        delivered += 1;
        throw new Error('boom');
      },
    });
    h.fire([filled(1601, 0.1)]);
    expect(delivered).toBe(1);
    h.fire([filled(1601, 0.1)]);
    expect(delivered).toBe(1);
  });

  it('单次回调含多个满块时，首个 consumer 抛错后不再交付同一批后续块', async () => {
    let delivered = 0;
    const h = await makeHarness({
      chunkBytes: 64, // targetSamples = 32
      onChunk: () => {
        delivered += 1;
        if (delivered === 1) throw new Error('boom');
      },
    });
    // 16k 直通 161 输入 → 161 输出 → 5 个满块（32×5=160）+ 1 残留。
    // 一次回调内 flushChunks 循环切出 5 块：第一个抛错后必须立即停止。
    h.fire([filled(161, 0.1)]);
    expect(delivered).toBe(1);
    expect(h.capture.state).toBe('failed');
    expect(h.failures).toEqual(['CONSUMER_FAILED']);
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    expect(h.context.closeCalls).toBe(1);
  });
});

// ── start 期间竞争 ─────────────────────────────────────────────────

describe('start 期间 stop/cancel 竞争（V16 必测）', () => {
  it('starting 中 stop：不交付任何 chunk，收敛 cancelled', async () => {
    const h = await makeHarness({ autoStart: false });
    const pending = h.capture.start();
    h.capture.stop();
    const result = await pending;
    expect(result).toEqual({ status: 'cancelled' });
    expect(h.capture.state).toBe('cancelled');
    expect(h.chunks).toHaveLength(0);
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
    // context 在 getUserMedia 完成后才创建；此时序下尚未创建，无需 close。
    expect(h.context.closeCalls).toBe(0);
  });

  it('starting 中 cancel：同样收敛 cancelled 且清理', async () => {
    const h = await makeHarness({ autoStart: false });
    const pending = h.capture.start();
    h.capture.cancel();
    const result = await pending;
    expect(result).toEqual({ status: 'cancelled' });
    expect(h.devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
  });

  it('starting 中 stop 且 getUserMedia 拒绝：按真实失败码收敛', async () => {
    const devices = new FakeMediaDevices();
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    devices.error = denied;
    const h = await makeHarness({ devices, autoStart: false });
    const pending = h.capture.start();
    h.capture.stop();
    await expect(pending).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(h.capture.state).toBe('failed');
  });

  it('cleanup 在 getUserMedia 等待期间调用：start 不得重启麦克风', async () => {
    const devices = new FakeMediaDevices();
    devices.gate = { resolve: () => undefined };
    const h = await makeHarness({ devices, autoStart: false });
    const pending = h.capture.start(); // getUserMedia 挂起
    h.capture.cleanup(); // 终态 stopped
    expect(h.capture.state).toBe('stopped');
    // 迟到的流在 cleanup 之后才到达。
    devices.gate!.resolve(devices.streams[0]!);
    const result = await pending;
    expect(result).toEqual({ status: 'cancelled' });
    // 终态不被覆盖为 recording，context 从未创建，迟到 track 被停掉。
    expect(h.capture.state).toBe('stopped');
    expect(h.context.closeCalls).toBe(0);
    expect(devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
  });

  it('cleanup 在 resume 等待期间调用：迟到的 context 被关闭', async () => {
    const context = new FakeAudioContext(16000, 'suspended');
    context.resumeGate = { resolve: () => undefined };
    const devices = new FakeMediaDevices();
    const h = await makeHarness({
      devices,
      autoStart: false,
      audioContextFactory: () => context,
    });
    const pending = h.capture.start();
    // 让 getUserMedia 完成、start 进入 resume 挂起点。
    await Promise.resolve();
    await Promise.resolve();
    expect(context.resumeCalls).toBe(1);
    h.capture.cleanup(); // 终态 stopped（此时 context 已创建）
    expect(h.capture.state).toBe('stopped');
    context.resumeGate!.resolve();
    const result = await pending;
    expect(result).toEqual({ status: 'cancelled' });
    expect(h.capture.state).toBe('stopped');
    expect(context.closeCalls).toBe(1); // 迟到创建的 context 已关闭
    expect(devices.streams[0]!.tracks[0]!.stopCalls).toBe(1);
  });
});

// ── SSR 安全、无网络、无持久化 ─────────────────────────────────────

describe('SSR 安全与无副作用（V16 必测）', () => {
  it('Node 环境导入与构造不触碰 window/navigator/AudioContext', () => {
    // vitest 默认 node 环境：无 window，navigator 无 mediaDevices，无 AudioContext。
    expect(typeof window).toBe('undefined');
    expect(
      (globalThis as { navigator?: { mediaDevices?: unknown } }).navigator
        ?.mediaDevices,
    ).toBeUndefined();
    expect(typeof AudioContext).toBe('undefined');
    const devices = new FakeMediaDevices();
    const capture = createAudioCapture({
      mediaDevices: devices,
      audioContextFactory: () => new FakeAudioContext(16000),
      onChunk: () => undefined,
    });
    expect(capture.state).toBe('idle');
    // 仅构造不触发任何浏览器调用。
    expect(devices.getUserMediaCalls).toBe(0);
    expect(typeof AudioContext).toBe('undefined');
  });

  it('完整采集流程不发起网络请求、不触碰存储 API', async () => {
    const fetchSpy = vi.fn();
    const wsSpy = vi.fn();
    const storageSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubGlobal('localStorage', {
      getItem: storageSpy,
      setItem: storageSpy,
      removeItem: storageSpy,
    });
    const h = await makeHarness();
    h.fire([filled(1600, 0.1)]);
    h.fire([filled(1600, 0.2)]);
    h.capture.stop();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('交付的 PCM 是独立拷贝：外部修改已交付 chunk 不影响后续交付', async () => {
    const h = await makeHarness();
    h.fire([filled(1601, 0.1)]);
    h.fire([filled(1601, 0.2)]);
    expect(h.chunks).toHaveLength(4);
    // 篡改第一个 chunk 不影响第二个。
    h.chunks[0]!.pcmBytes.fill(0xff);
    // 第二个 chunk 首样本是上一块的延迟样本（0.1），第 2 个样本才是 0.2。
    expect(readInt16Le(h.chunks[2]!.pcmBytes, 0)).toBe(Math.round(0.1 * 32768));
    expect(readInt16Le(h.chunks[2]!.pcmBytes, 1)).toBe(Math.round(0.2 * 32768));
  });

  it('默认 chunkBytes 为 1600（50ms @16kHz mono s16le）', () => {
    expect(DEFAULT_CHUNK_BYTES).toBe(1600);
    expect(DEFAULT_CHUNK_BYTES).toBeLessThanOrEqual(MAX_PCM_CHUNK_BYTES);
  });

  it('错误对象只携带稳定码，不携带浏览器原始信息', async () => {
    const devices = new FakeMediaDevices();
    const denied = new Error('原始 message 含设备细节');
    denied.name = 'NotAllowedError';
    devices.error = denied;
    const h = await makeHarness({ devices, autoStart: false });
    let threw = false;
    try {
      await h.capture.start();
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(AudioCaptureError);
      const captureError = error as AudioCaptureError;
      expect(captureError.code).toBe('PERMISSION_DENIED');
      expect(captureError.message).toBe('PERMISSION_DENIED');
      expect(captureError.message).not.toContain('设备');
      expect(String(error)).not.toContain('原始 message');
    }
    expect(threw).toBe(true);
  });
});
