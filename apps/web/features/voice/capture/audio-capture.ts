/**
 * 浏览器音频采集与重采样（V16）— SSR 安全、无网络、无持久化。
 *
 * ## 架构
 *
 * 采集路径：`getUserMedia` → `MediaStreamAudioSourceNode` →
 * `ScriptProcessorNode`（onaudioprocess 提供 Float32 块）→ 多声道归并
 * mono → 确定性重采样到 16 kHz → Float32 转 PCM16LE → 按固定目标大小
 * 切分为有界 chunk 交给 consumer。
 *
 * 选择 ScriptProcessorNode 而非 AudioWorklet：后者需要 `addModule` 加载
 * worklet 文件（同源请求），与"本任务不发送网络请求"冲突；ScriptProcessor
 * 是纯内存路径，且不写 outputBuffer 时输出静音，不会产生声音。
 *
 * ## SSR 安全
 *
 * 模块顶层不读取 window/navigator/AudioContext；所有浏览器 API 都通过
 * 构造注入的 `mediaDevices` / `audioContextFactory` 访问，Node 环境可以
 * 直接导入并在不调用 start 的情况下安全构造（测试覆盖）。
 *
 * ## 生命周期与终态
 *
 * state：`idle → starting → recording`；终态 `stopped | cancelled |
 * failed` 至多到达一次（`settled` 守卫，stop/cancel/cleanup 幂等）。
 * - stop：冲刷重采样器尾部，把剩余样本作为最后一个 chunk 交付，再清理；
 * - cancel：丢弃全部未交付样本，不产生新 chunk，直接清理；
 * - consumer 抛错：立即进入 failed 并清理，通过 `onFailure` 通知稳定码；
 * - start 进行中收到 stop/cancel：置 `startCancelled` 标志，start 完成后
 *   不再启动采集并清理（不交付任何 chunk）。
 *
 * ## 错误面
 *
 * 只抛/只回调 `AudioCaptureError`（稳定码，见 capture-errors.ts）。浏览器
 * 原始异常只用于内部判定错误码（读取 err.name 分支），从不外泄。
 *
 * ## 不变量
 *
 * - chunk.sequence 从 0 连续递增，跨会话不残留（每次 start 重新从 0 开始）；
 * - 每个 chunk 非空、偶数字节、不超过 V04 MAX_PCM_CHUNK_BYTES；
 * - PCM 不落盘、不入 localStorage/IndexedDB、不发网络请求；
 * - 停止路径保证所有资源（track/node/context）被清理。
 */

import {
  MAX_PCM_CHUNK_BYTES,
  STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
} from '@educanvas/agent-core';
import {
  AudioCaptureError,
  type AudioCaptureFailureCode,
} from './capture-errors';
import { mixChannelsToMono, float32ToPcm16Le } from './pcm';
import { createLinearResampler, type LinearResampler } from './resampler';

/** 默认目标 chunk 字节数 = 100 ms @16 kHz/mono/s16le（V04 文档实测粒度）。 */
export const DEFAULT_CHUNK_BYTES = 3_200 as const;

/** 采集器处理块大小：输入声道声明 2（覆盖常见立体声/单声道流）。 */
const PROCESSOR_BUFFER_SIZE = 4096;

export type AudioCaptureState =
  'idle' | 'starting' | 'recording' | 'stopped' | 'cancelled' | 'failed';

/** 交付给 consumer 的 PCM chunk：字节 + 会话内连续序号。 */
export interface AudioPcmChunk {
  /** 从 0 连续递增；operationId/segmentId 由上层（V17 transport）补齐。 */
  sequence: number;
  /** 非空、偶数字节、≤ MAX_PCM_CHUNK_BYTES 的 pcm_s16le 数据。 */
  pcmBytes: Uint8Array;
}

// ── 浏览器 API 的最小可注入抽象（fake 与真实实现都满足）──────────────

export interface AudioSampleBufferLike {
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface ScriptProcessorNodeLike extends AudioNodeLike {
  onaudioprocess:
    ((event: { inputBuffer: AudioSampleBufferLike }) => void) | null;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly state: 'suspended' | 'running' | 'closed';
  readonly destination: AudioNodeLike;
  createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike;
  createScriptProcessor(
    bufferSize: number,
    inputChannelCount: number,
    outputChannelCount: number,
  ): ScriptProcessorNodeLike;
  createGain(): AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface MediaStreamTrackLike {
  stop(): void;
}

export interface MediaStreamLike {
  getTracks(): MediaStreamTrackLike[];
}

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}

export interface AudioCaptureDependencies {
  mediaDevices: MediaDevicesLike;
  audioContextFactory: () => AudioContextLike;
  /** 有界 PCM chunk 消费者；抛错会终止采集（CONSUMER_FAILED）。 */
  onChunk: (chunk: AudioPcmChunk) => void;
  /** 可选：异步失败通知（consumer 抛错、start 失败后）。 */
  onFailure?: (code: AudioCaptureFailureCode) => void;
}

export interface AudioCaptureOptions {
  /**
   * 每满 chunk 的目标字节数（偶数，2..MAX_PCM_CHUNK_BYTES，默认
   * DEFAULT_CHUNK_BYTES=3200）。最后一个不满的 chunk 在 stop 时交付。
   */
  chunkBytes?: number;
}

export interface AudioCapture {
  readonly state: AudioCaptureState;
  /**
   * 启动采集。成功 resolve { status: 'recording' }；start 期间被
   * stop/cancel 则 resolve { status: 'cancelled' }（不交付任何 chunk）；
   * 权限/设备/上下文失败 reject AudioCaptureError。
   */
  start(): Promise<{ status: 'recording' } | { status: 'cancelled' }>;
  /** 正常停止：冲刷剩余样本作为最后 chunk 交付后清理；幂等。 */
  stop(): void;
  /** 放弃：丢弃未交付尾部，不产生新 chunk，清理资源；幂等。 */
  cancel(): void;
  /** 立即释放 track/node/context；幂等，stop/cancel 内部已调用。 */
  cleanup(): void;
}

/** getUserMedia 浏览器错误名 → 稳定码（只读取 err.name，不外泄原始异常）。 */
function mapGetUserMediaError(error: unknown): AudioCaptureFailureCode {
  if (error instanceof Error) {
    const name = error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'PERMISSION_DENIED';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'NO_AUDIO_INPUT';
    }
  }
  return 'CAPTURE_FAILED';
}

/** 校验 chunkBytes：偶数、在 [2, MAX_PCM_CHUNK_BYTES] 内。 */
function validateChunkBytes(chunkBytes: number): number {
  if (
    !Number.isInteger(chunkBytes) ||
    chunkBytes < 2 ||
    chunkBytes > MAX_PCM_CHUNK_BYTES ||
    chunkBytes % 2 !== 0
  ) {
    throw new AudioCaptureError('INVALID_OPTIONS');
  }
  return chunkBytes;
}

export function createAudioCapture(
  deps: AudioCaptureDependencies,
  options: AudioCaptureOptions = {},
): AudioCapture {
  const chunkBytes = validateChunkBytes(
    options.chunkBytes ?? DEFAULT_CHUNK_BYTES,
  );
  // 每满 chunk 的 mono 样本数（字节 / 2，s16le 每样本 2 字节）。
  const targetSamples = chunkBytes / 2;

  let state: AudioCaptureState = 'idle';
  /** 终态守卫：settled 后所有动作成为 no-op（幂等）。 */
  let settled = false;
  /** start 异步流程进行中被 stop/cancel 置位。 */
  let startCancelled = false;

  let stream: MediaStreamLike | null = null;
  let context: AudioContextLike | null = null;
  let sourceNode: AudioNodeLike | null = null;
  let processor: ScriptProcessorNodeLike | null = null;
  let resampler: LinearResampler | null = null;

  let sequence = 0;
  /** 已重采样但未满一个 chunk 的输出样本（number[] 累积，游标切块）。 */
  let pending: number[] = [];
  let pendingStart = 0;

  /** 交付一个满/尾 chunk；consumer 抛错则终止采集。返回 false 表示
   *  本次交付失败（已进入终态），调用方必须立即停止后续交付。 */
  function deliver(samples: Float32Array): boolean {
    if (settled) return false;
    const pcmBytes = float32ToPcm16Le(samples);
    const chunk: AudioPcmChunk = { sequence, pcmBytes };
    sequence += 1;
    try {
      deps.onChunk(chunk);
    } catch {
      fail('CONSUMER_FAILED');
      return false;
    }
    return true;
  }

  /** 把 pending 中满 chunk 切出交付；首个失败立即停止同一批剩余块。 */
  function flushChunks(): void {
    while (pending.length - pendingStart >= targetSamples) {
      const samples = pending.slice(pendingStart, pendingStart + targetSamples);
      pendingStart += targetSamples;
      // 一次音频回调可能切出多个满块：第一个 consumer 抛错已进入 failed，
      // 必须立刻终止，不得继续交付同一回调产生的后续 PCM。
      if (!deliver(Float32Array.from(samples))) return;
    }
    // 周期压缩已消费前缀，把数组长度压回有界（≤ 4096 + 一个 chunk），
    // 防止长时间会话数组首部被已消费元素占据而持续增长。
    if (pendingStart > 4096) {
      pending = pending.slice(pendingStart);
      pendingStart = 0;
    }
  }

  /** ScriptProcessorNode 音频回调：归并 mono → 重采样 → 切 chunk。 */
  function handleAudio(inputBuffer: AudioSampleBufferLike): void {
    if (settled || resampler === null) return;
    const channelCount = inputBuffer.numberOfChannels;
    let mono: Float32Array;
    if (channelCount <= 1) {
      mono = inputBuffer.getChannelData(0);
    } else {
      const channels: Float32Array[] = [];
      for (let c = 0; c < channelCount; c += 1) {
        channels.push(inputBuffer.getChannelData(c));
      }
      mono = mixChannelsToMono(channels);
    }
    const resampled = resampler.push(mono);
    for (let i = 0; i < resampled.length; i += 1) {
      pending.push(resampled[i]!);
    }
    flushChunks();
  }

  /** 资源释放：先停 track，再断开节点，最后关闭 context；全部幂等。 */
  function releaseResources(): void {
    if (stream !== null) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (processor !== null) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // 节点可能已被音频图卸载；断开失败不影响后续清理。
      }
      processor = null;
    }
    if (sourceNode !== null) {
      try {
        sourceNode.disconnect();
      } catch {
        // 同上：断开失败可安全忽略。
      }
      sourceNode = null;
    }
    if (context !== null) {
      void context.close().catch(() => {
        // close 失败（罕见）不影响已完成的 track/node 清理。
      });
      context = null;
    }
  }

  /** 进入终态（幂等）并清理；failed 时通知稳定码。
   *  任何终态都终止进行中的 start 流程（置 startCancelled），否则
   *  getUserMedia/resume 等待期间到达的终态会让 start 继续创建
   *  AudioContext 并进入 recording（麦克风被重新启动）。 */
  function settle(
    next: AudioCaptureState,
    failureCode?: AudioCaptureFailureCode,
  ): void {
    if (settled) return;
    settled = true;
    state = next;
    startCancelled = true;
    releaseResources();
    if (next === 'failed' && failureCode !== undefined) {
      deps.onFailure?.(failureCode);
    }
  }

  /** 采集异常路径：终止并清理（consumer 抛错、start 内部失败共用）。 */
  function fail(code: AudioCaptureFailureCode): void {
    settle('failed', code);
  }

  /** 放弃进行中的启动：停掉迟到获得的 track、关闭迟到创建的 context。
   *  若终态已由 stop/cancel/cleanup 提前收敛（settle 已执行），这里只
   *  释放绕过 settle 的迟到资源；否则收敛为 cancelled。幂等。 */
  function abandonLateStart(): { status: 'cancelled' } {
    if (context !== null) {
      void context.close().catch(() => {
        // 迟到创建的 context：settle 可能已清理过其他资源，这里单独关闭。
      });
      context = null;
    }
    if (stream !== null) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    settle('cancelled');
    return { status: 'cancelled' };
  }

  async function start(): Promise<
    { status: 'recording' } | { status: 'cancelled' }
  > {
    if (state !== 'idle' || settled) {
      throw new AudioCaptureError('INVALID_STATE');
    }
    state = 'starting';
    // 阶段 1：获取麦克风。失败按 getUserMedia 错误分类映射稳定码。
    try {
      stream = await deps.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const code = mapGetUserMediaError(error);
      fail(code);
      throw new AudioCaptureError(code);
    }
    // 等待期间可能已被 stop/cancel/cleanup 终态化：立即放弃，不启动。
    if (startCancelled || settled) {
      return abandonLateStart();
    }
    // 阶段 2：创建并连线 AudioContext。工厂抛错、resume 失败、节点创建
    // 失败与非法 sampleRate（RangeError）统一映射 AUDIO_CONTEXT_FAILED，
    // 浏览器原始异常不越过边界。
    try {
      const ctx = deps.audioContextFactory();
      context = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      // resume 等待期间同样可能已被终态化：关闭迟到创建的 context。
      if (startCancelled || settled) {
        return abandonLateStart();
      }
      sourceNode = ctx.createMediaStreamSource(stream);
      // 输入声道声明 2：MediaStreamAudioSourceNode 的声道数随流变化，
      // handleAudio 按 inputBuffer.numberOfChannels 动态归并，声明值只是
      // processor 的输入声道上限。
      processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 2, 1);
      // 不写 outputBuffer → 输出静音；连到 destination 是 onaudioprocess
      // 被调度的前提（MDN），不会产生可听输出。
      processor.onaudioprocess = (event) => handleAudio(event.inputBuffer);
      sourceNode.connect(processor);
      processor.connect(ctx.destination);

      resampler = createLinearResampler(
        ctx.sampleRate,
        STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
      );
      state = 'recording';
      return { status: 'recording' };
    } catch (error) {
      if (error instanceof AudioCaptureError) {
        fail(error.code);
        throw error;
      }
      fail('AUDIO_CONTEXT_FAILED');
      throw new AudioCaptureError('AUDIO_CONTEXT_FAILED');
    }
  }

  function stop(): void {
    if (settled) return;
    if (state === 'idle') {
      settle('stopped');
      return;
    }
    if (state === 'starting') {
      startCancelled = true;
      return;
    }
    if (state === 'recording' && resampler !== null) {
      // 冲刷重采样器尾部（零阶保持）并作为最后一个 chunk 交付（非空才交付）。
      const tail = resampler.finish();
      for (let i = 0; i < tail.length; i += 1) {
        pending.push(tail[i]!);
      }
      const remaining = pending.slice(pendingStart);
      if (remaining.length > 0) {
        deliver(Float32Array.from(remaining));
      }
      settle('stopped');
    }
  }

  function cancel(): void {
    if (settled) return;
    if (state === 'starting') {
      startCancelled = true;
      return;
    }
    if (state === 'idle') {
      settle('cancelled');
      return;
    }
    // recording：丢弃全部未交付尾部，不冲刷、不交付。
    pending = [];
    pendingStart = 0;
    settle('cancelled');
  }

  return {
    get state() {
      return state;
    },
    start,
    stop,
    cancel,
    /** 公开清理：释放全部资源并把状态收敛为 stopped（若尚未终态）。 */
    cleanup: () => settle('stopped'),
  };
}
