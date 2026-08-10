import type { StreamingTranscriptionSnapshot } from '@educanvas/agent-core';
import type {
  StreamingTranscriptionClientLogEntry,
  StreamingTranscriptionClientStatus,
  StreamingTranscriptionTerminalResult,
} from './streaming-transcription-client';

export interface StreamingTranscriptionObserverOptions {
  readonly log?: (entry: StreamingTranscriptionClientLogEntry) => void;
  readonly onSnapshot?: (snapshot: StreamingTranscriptionSnapshot) => void;
  readonly onStatus?: (status: StreamingTranscriptionClientStatus) => void;
  readonly onTerminal?: (result: StreamingTranscriptionTerminalResult) => void;
}

/**
 * 隔离 UI 与诊断观察者：回调只能观察 transport，不能改变其终态、连接清理
 * 或凭证生命周期。所有回调均为 best-effort，异常止于此边界。
 */
export class StreamingTranscriptionObservers {
  constructor(
    private readonly options: StreamingTranscriptionObserverOptions,
  ) {}

  log(entry: StreamingTranscriptionClientLogEntry): void {
    this.invoke(this.options.log, entry);
  }

  snapshot(value: StreamingTranscriptionSnapshot): void {
    this.invoke(this.options.onSnapshot, value);
  }

  status(value: StreamingTranscriptionClientStatus): void {
    this.invoke(this.options.onStatus, value);
  }

  terminal(value: StreamingTranscriptionTerminalResult): void {
    this.invoke(this.options.onTerminal, value);
  }

  private invoke<T>(
    callback: ((value: T) => void) | undefined,
    value: T,
  ): void {
    try {
      callback?.(value);
    } catch {
      // Observer failures never affect the transport state machine.
    }
  }
}
