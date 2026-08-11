/**
 * 语音会话控制器（V17-B）— 组合 V16 AudioCapture 与 V17-A
 * StreamingTranscriptionClient 的可复用控制层（UI 无关、SSR 安全）。
 *
 * ## 职责
 *
 * 把一个"语音会话"编排为受控生命周期：点击开始 → 建立实时转录连接 →
 * 启动麦克风采集 → PCM chunk 从 capture 转发到 client → 服务端事件经 V05
 * reducer 快照投影为 partial / final；final 只交付一次，由组合层进入现有 Turn。
 *
 * ## 依赖注入
 *
 * 控制器不直接构造 capture/client，也不读取任何浏览器全局：V17 集成层把
 * `createCapture` / `createClient` 工厂注入，工厂在**用户点击之后**才被
 * 调用，浏览器 API（getUserMedia / WebSocket）只在那一刻发生——SSR 导入
 * 与初始渲染零副作用。
 *
 * ## 生命周期与唯一终态
 *
 * - `idle → starting → authorizing → recording → finalizing → stopped`；`cancelled` /
 *   `failed` 是其余终态；终态**只收敛一次**（settled 守卫），之后所有
 *   事件回调与用户动作成为 no-op；
 * - `stop()`：冲刷采集器尾部 chunk 后 `finish()`，等待 final；
 * - `cancel()`：丢弃未发送 PCM 并取消连接，本地立即收敛 `cancelled`；
 * - `dispose()`：卸载/撤回/模式切换时无条件清理 capture 与 client 并释放
 *   引用（幂等）；原始 PCM 不落盘、不进日志、不留存。
 *
 * ## 错误面
 *
 * 稳定码：透传 V16 采集码（PERMISSION_DENIED / NO_AUDIO_INPUT / ...）与
 * V17-A 传输码（TICKET_FAILED / CONNECTION_FAILED / PROTOCOL_ERROR /
 * ABORTED / MODEL_FAILED / UNKNOWN）。日志只含受控标签与稳定码，不含 PCM、
 * 文本、ticket、bearer 或堆栈。
 */

import type { StreamingTranscriptionSnapshot } from '@educanvas/agent-core';
import {
  AudioCaptureError,
  type AudioCaptureFailureCode,
} from './capture/capture-errors';
import type { AudioCapture, AudioPcmChunk } from './capture/audio-capture';
import {
  StreamingTranscriptionClientError,
  type StreamingTranscriptionClientStatus,
  type StreamingTranscriptionTerminalResult,
} from './transport';
import {
  mapClientStartError,
  mapTerminalToError,
} from './voice-session-errors';

/** 会话阶段（UI 可显示）。 */
export type VoiceSessionStatus =
  | 'idle'
  | 'starting'
  | 'authorizing'
  | 'recording'
  | 'finalizing'
  | 'stopped'
  | 'cancelled'
  | 'failed';

/**
 * 会话稳定错误码：V16 采集侧码 + V17-A 传输侧码的并集，外加两个本地码
 * （INVALID_STATE / UNKNOWN 兜底）。错误面不携带浏览器/服务端原始消息。
 */
export type VoiceSessionErrorCode =
  | 'PERMISSION_DENIED'
  | 'NO_AUDIO_INPUT'
  | 'AUDIO_CONTEXT_FAILED'
  | 'CAPTURE_FAILED'
  | 'CONSUMER_FAILED'
  | 'INVALID_STATE'
  | 'INVALID_OPTIONS'
  | 'TICKET_FAILED'
  | 'CONNECTION_FAILED'
  | 'PROTOCOL_ERROR'
  | 'ABORTED'
  | 'MODEL_FAILED'
  | 'UNKNOWN';

/** capture 工厂的回调面：控制器注入，V16 集成层绑定到 createAudioCapture deps。 */
export interface VoiceSessionCaptureHandlers {
  onChunk: (chunk: AudioPcmChunk) => void;
  onFailure: (code: AudioCaptureFailureCode) => void;
  onLevel?: (level: number) => void;
}

/** client 工厂的回调面：控制器注入，V17-A 集成层绑定到 client options。 */
export interface VoiceSessionClientHandlers {
  onSnapshot: (snapshot: StreamingTranscriptionSnapshot) => void;
  onStatus: (status: StreamingTranscriptionClientStatus) => void;
  onTerminal: (result: StreamingTranscriptionTerminalResult) => void;
}

/**
 * 控制器依赖的传输客户端最小接口：V17-A `StreamingTranscriptionClient`
 * 天然满足；测试注入 fake。不依赖具体类，避免把控制器绑定到实现。
 */
export interface VoiceSessionTranscriptionClient {
  start(input: { notebookId: string; signal?: AbortSignal }): Promise<void>;
  sendChunk(pcmBytes: Uint8Array): void;
  finish(): void;
  cancel(): void;
  disconnect(): void;
}

export interface VoiceSessionControllerDeps {
  /** 当前 Notebook：client.start 的会话归属（服务端据此绑定访问权限）。 */
  readonly notebookId: string;
  /** capture 工厂（点击后调用；回调面由控制器注入）。 */
  readonly createCapture: (
    handlers: VoiceSessionCaptureHandlers,
  ) => AudioCapture;
  /** client 工厂（点击后调用；回调面由控制器注入）。 */
  readonly createClient: (
    handlers: VoiceSessionClientHandlers,
  ) => VoiceSessionTranscriptionClient;
  /** partial 文本更新（连续修正，含 final 定稿后的最终文本）。 */
  readonly onPartialText?: (text: string) => void;
  /** 本地归一化输入能量；不写日志、不进入协议。 */
  readonly onInputLevel?: (level: number) => void;
  /** 会话终态 final 时回调一次。 */
  readonly onFinalText?: (text: string) => void;
  /** 阶段变化通知。 */
  readonly onStatusChange?: (status: VoiceSessionStatus) => void;
  /** 稳定错误码通知（终态 failed 时）。 */
  readonly onError?: (code: VoiceSessionErrorCode) => void;
  /** 脱敏日志 sink；缺省静默。 */
  readonly log?: (entry: VoiceSessionLogEntry) => void;
}

/** 日志条目：只含受控标签与稳定码。 */
export interface VoiceSessionLogEntry {
  readonly label:
    | 'session_started'
    | 'chunk_forwarded'
    | 'final_delivered'
    | 'session_stopped'
    | 'session_cancelled'
    | 'session_failed'
    | 'capture_failed'
    | 'disposed';
  readonly code?: string;
}

/**
 * 单会话控制器：一次 start 对应一个采集会话 + 一个转录 operation；
 * 重新开始由调用方新建实例（V17-A client 与 V16 capture 均一次性）。
 */
export class VoiceSessionController {
  private readonly deps: VoiceSessionControllerDeps;
  private capture: AudioCapture | null = null;
  private client: VoiceSessionTranscriptionClient | null = null;
  private status: VoiceSessionStatus = 'idle';
  private settled = false;
  private lastSnapshot: StreamingTranscriptionSnapshot | null = null;
  private lastPartialText = '';

  constructor(deps: VoiceSessionControllerDeps) {
    this.deps = deps;
  }

  getState(): VoiceSessionStatus {
    return this.status;
  }

  /**
   * 启动会话（用户点击后调用）：先建连接（client.start），成功后启动
   * 麦克风采集（capture.start）。任一阶段失败都收敛为 failed 终态并通知
   * 稳定错误码；连接失败时绝不请求麦克风。
   */
  async start(): Promise<void> {
    if (this.settled || this.status !== 'idle') {
      // 已终态/运行中再次 start：只通知稳定错误，不改状态（settle 守卫
      // 已锁存，不能通过 settle 表达）。
      this.deps.onError?.('INVALID_STATE');
      return;
    }
    this.setStatus('starting');
    let client: VoiceSessionTranscriptionClient;
    try {
      client = this.deps.createClient({
        onSnapshot: (snapshot) => this.applySnapshot(snapshot),
        // 传输层阶段细节（open/terminal 前的中间态）不暴露给 UI。
        onStatus: () => undefined,
        onTerminal: (result) => this.handleClientTerminal(result),
      });
    } catch {
      // 集成层工厂违约（接线错误）：收敛为稳定失败，不把异常带出。
      this.settle('failed', 'UNKNOWN');
      return;
    }
    this.client = client;
    try {
      await client.start({ notebookId: this.deps.notebookId });
    } catch (error) {
      if (this.settled) return; // dispose 在连接期间发生
      const code =
        error instanceof StreamingTranscriptionClientError
          ? mapClientStartError(error.code)
          : 'UNKNOWN';
      // 连接未建立：不启动麦克风。
      this.settle('failed', code);
      return;
    }
    if (this.settled) return; // dispose 在连接完成与采集启动之间发生
    this.setStatus('authorizing');
    let capture: AudioCapture;
    try {
      // 连接成功后才构造采集器：即便未来 factory 增加设备探测或预热，
      // ticket/connection 失败路径也绝不触碰麦克风侧资源。
      capture = this.deps.createCapture({
        onChunk: (chunk) => this.forwardChunk(chunk),
        onFailure: (code) => this.handleCaptureFailure(code),
        onLevel: (level) => this.deps.onInputLevel?.(level),
      });
    } catch {
      this.disconnectClientQuietly();
      this.settle('failed', 'UNKNOWN');
      return;
    }
    this.capture = capture;
    this.log({ label: 'session_started' });
    try {
      const result = await capture.start();
      if (result.status === 'recording' && !this.settled) {
        this.setStatus('recording');
      }
      // result.status === 'cancelled'：采集启动期间被 dispose 终态化，忽略。
    } catch (error) {
      if (this.settled) return;
      const code =
        error instanceof AudioCaptureError ? error.code : 'CAPTURE_FAILED';
      // 连接已建但无音频输入：取消转录会话，避免服务端空等。
      this.cancelClientQuietly();
      this.settle('failed', code);
    }
  }

  /** 结束输入：冲刷采集尾部后 finish()，等待服务端 final。 */
  stop(): void {
    if (this.settled) return;
    if (this.status !== 'recording') return;
    this.setStatus('finalizing');
    // capture.stop() 同步交付尾部 chunk（onChunk → sendChunk），随后
    // finish() 声明输入结束——顺序保证所有 PCM 先于 finish 上线。
    this.capture?.stop();
    this.client?.finish();
  }

  /** 放弃：丢弃未发送 PCM、取消连接，本地立即收敛 cancelled。 */
  cancel(): void {
    if (this.settled) return;
    if (this.status === 'starting' || this.status === 'authorizing') {
      /*
       * 系统麦克风授权可能长期悬挂；关闭 Live 必须让迟到的连接/授权结果
       * 无法重新启动采集。starting 尚不能发协议 cancel，因此直接断开。
       */
      this.capture?.cancel();
      this.disconnectClientQuietly();
      this.settle('cancelled');
      return;
    }
    if (this.status !== 'recording' && this.status !== 'finalizing') return;
    this.capture?.cancel();
    if (this.status === 'recording') {
      // recording：协议允许发 cancel，服务端收敛为 failed + CANCELLED。
      this.cancelClientQuietly();
    } else {
      // finalizing：finish 已发，协议禁止再发 cancel；但仍必须释放连接
      // （disconnect 幂等），否则连接悬挂直到 dispose（REVISE）。
      this.disconnectClientQuietly();
    }
    this.settle('cancelled');
  }

  /**
   * 无条件清理（卸载/撤回/模式切换）：停止采集、断开连接、释放引用。
   * 幂等；settle 只发生一次，但资源清理每次都会执行（capture/client
   * 自身的清理幂等）。
   */
  dispose(): void {
    this.capture?.cleanup();
    this.disconnectClientQuietly();
    this.capture = null;
    this.client = null;
    if (!this.settled) this.settle('stopped');
    this.log({ label: 'disposed' });
  }

  /** recording 阶段的 PCM chunk 转发；采集器违约早产 chunk 直接忽略。 */
  private forwardChunk(chunk: AudioPcmChunk): void {
    if (this.settled || this.status !== 'recording') return;
    try {
      this.client?.sendChunk(chunk.pcmBytes);
      this.log({ label: 'chunk_forwarded' });
    } catch {
      // chunk 转发失败（理论不可达：V16 保证 chunk 合法）：终止会话，
      // 不把未知错误带出。
      this.capture?.cancel();
      this.settle('failed', 'UNKNOWN');
    }
  }

  /** V05 reducer 快照投影：partial 连续修正。 */
  private applySnapshot(snapshot: StreamingTranscriptionSnapshot): void {
    if (this.settled) return;
    this.lastSnapshot = snapshot;
    if (snapshot.combinedText !== this.lastPartialText) {
      this.lastPartialText = snapshot.combinedText;
      this.deps.onPartialText?.(snapshot.combinedText);
    }
  }

  /** client 终态：final 按模式交付一次；其余按稳定码收敛 failed。 */
  private handleClientTerminal(
    result: StreamingTranscriptionTerminalResult,
  ): void {
    if (this.settled) return;
    if (result.reason === 'final') {
      const text = this.lastSnapshot?.combinedText ?? '';
      if (text.length > 0) {
        this.deps.onFinalText?.(text);
        this.log({ label: 'final_delivered' });
      }
      this.settle('stopped');
    } else if (result.reason === 'cancelled') {
      this.settle('cancelled');
    } else {
      this.settle('failed', mapTerminalToError(result));
    }
    // 会话结束即停止采集（丢弃未发送尾部；幂等）。
    this.capture?.cancel();
  }

  /** 采集侧异步失败（consumer 抛错等）：取消连接并收敛 failed。 */
  private handleCaptureFailure(code: AudioCaptureFailureCode): void {
    if (this.settled) return;
    this.log({ label: 'capture_failed', code });
    this.cancelClientQuietly();
    this.settle('failed', code);
  }

  /** 取消连接但不改变会话状态（采集失败/取消路径共用；忽略已终态 client）。 */
  private cancelClientQuietly(): void {
    try {
      this.client?.cancel();
    } catch {
      // client 已终态或 finish 已发：取消不可用，忽略。
    }
  }

  /** 释放连接（幂等）；协议禁止发 cancel 时（finish 已发）用于释放资源。 */
  private disconnectClientQuietly(): void {
    try {
      this.client?.disconnect();
    } catch {
      // 断开失败不影响本地终态收敛。
    }
  }

  private settle(
    next: VoiceSessionStatus,
    errorCode?: VoiceSessionErrorCode,
  ): void {
    if (this.settled) return;
    this.settled = true;
    if (errorCode !== undefined) {
      this.deps.onError?.(errorCode);
      this.log({ label: 'session_failed', code: errorCode });
    }
    this.setStatus(next);
  }

  private setStatus(next: VoiceSessionStatus): void {
    this.status = next;
    this.deps.onStatusChange?.(next);
  }

  private log(entry: VoiceSessionLogEntry): void {
    try {
      this.deps.log?.(entry);
    } catch {
      // 日志故障不影响会话终态与清理。
    }
  }
}
