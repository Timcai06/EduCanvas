/**
 * Shared test helpers for the experiment-runtime package.
 * Not a test file; imported by the per-concern test suites.
 */

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { vi } from 'vitest';
import type { ExperimentRun, ExperimentRunEvent } from '@educanvas/agent-core';
import type {
  DockerChildProcess,
  DockerProcessPort,
} from './docker-process-port';
import type { ResolveCodeFn, ResolveInputFn } from './run-materializer';
import { sha256hex } from './run-materializer';

export const DEFAULT_CODE_BYTES = new TextEncoder().encode('print("hello")');
export const DEFAULT_INPUT_BYTES = new TextEncoder().encode('a,b,c\n1,2,3');

export function makeCodeBytes(content: string = 'print("hello")'): Uint8Array {
  return new TextEncoder().encode(content);
}

export function makeInputBytes(content: string = 'a,b,c\n1,2,3'): Uint8Array {
  return new TextEncoder().encode(content);
}

export function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    runId: 'run-001',
    notebookId: 'nb-001',
    codeVersionId: 'code-v1',
    codeHash: sha256hex(DEFAULT_CODE_BYTES),
    environmentId: 'cpu-python-3.11',
    inputs: [
      {
        mountName: 'data',
        artifactId: 'art-001',
        artifactVersionId: 'art-v1',
        mimeType: 'text/csv',
        checksum: sha256hex(DEFAULT_INPUT_BYTES),
        byteSize: DEFAULT_INPUT_BYTES.byteLength,
      },
    ],
    dependencies: [{ name: 'python', version: '3.11.15' }],
    randomSeed: 42,
    resourceBudget: {
      maxDurationMs: 30_000,
      maxMemoryMiB: 256,
      maxProcesses: 64,
      maxStdoutBytes: 1024 * 1024,
      maxLogBytes: 2 * 1024 * 1024,
      maxOutputBytes: 10 * 1024 * 1024,
      maxOutputFiles: 10,
    },
    ...overrides,
  };
}

export function makeAbortSignal(): {
  signal: AbortSignal;
  abort: () => void;
} {
  const ctrl = new AbortController();
  return { signal: ctrl.signal, abort: () => ctrl.abort() };
}

/**
 * A mock docker child process with explicit control over streamed output
 * and exit. Does NOT self-close: tests drive emitStdout/emitStderr/close,
 * which is required to exercise immediate cleanup on quota exceeded.
 */
export class MockDockerProcess extends EventEmitter {
  readonly stdout = new Readable({ read() {} });
  readonly stderr = new Readable({ read() {} });
  killed = false;
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => {
    this.killed = true;
    return true;
  });

  emitStdout(text: string): void {
    this.stdout.emit('data', Buffer.from(text));
  }

  emitStderr(text: string): void {
    this.stderr.emit('data', Buffer.from(text));
  }

  endStreams(): void {
    this.stdout.push(null);
    this.stderr.push(null);
  }

  close(code: number | null): void {
    this.endStreams();
    this.emit('close', code);
  }

  fail(error: Error): void {
    this.emit('error', error);
  }
}

export interface MockDockerPort extends DockerProcessPort {
  readonly runCalls: {
    command: readonly string[];
  }[];
  readonly rmCalls: string[];
  readonly process: MockDockerProcess;
}

/**
 * A docker port whose dockerRun returns a fresh MockDockerProcess and
 * records every docker rm -f container name.
 */
export function makeMockDockerPort(): MockDockerPort {
  const runCalls: {
    command: readonly string[];
  }[] = [];
  const rmCalls: string[] = [];
  const process = new MockDockerProcess();
  const port: MockDockerPort = {
    runCalls,
    rmCalls,
    process,
    dockerRun(options) {
      runCalls.push({ command: options.command });
      return process;
    },
    dockerRmForce(options) {
      rmCalls.push(options.containerName);
      return Promise.resolve();
    },
  };
  return port;
}

export function defaultCodeResolver(): ResolveCodeFn {
  return async (_codeVersionId: string, _codeHash: string) => {
    const bytes = makeCodeBytes();
    return { bytes, checksum: sha256hex(bytes) };
  };
}

export function defaultInputResolver(): ResolveInputFn {
  return async () => {
    const bytes = makeInputBytes();
    return { bytes, checksum: sha256hex(bytes), byteSize: bytes.byteLength };
  };
}

export async function collectEvents(
  iterable: AsyncIterable<ExperimentRunEvent>,
): Promise<ExperimentRunEvent[]> {
  const events: ExperimentRunEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

export interface StartedRun {
  readonly events: ExperimentRunEvent[];
  readonly iter: AsyncIterator<ExperimentRunEvent>;
}

/**
 * Begin consuming a run and wait for the first ('started') event. After this
 * resolves, the runner has attached its listeners, so tests can safely drive
 * the mock process (emitStdout / close) without losing events.
 */
export async function startRun(
  iterable: AsyncIterable<ExperimentRunEvent>,
): Promise<StartedRun> {
  const events: ExperimentRunEvent[] = [];
  const iter = iterable[Symbol.asyncIterator]();
  events.push((await iter.next()).value as ExperimentRunEvent);
  return { events, iter };
}

export async function drain(
  started: StartedRun,
): Promise<ExperimentRunEvent[]> {
  for (;;) {
    const next = await started.iter.next();
    if (next.done) break;
    started.events.push(next.value);
  }
  return started.events;
}

export function getTerminalEvent(
  events: ExperimentRunEvent[],
): ExperimentRunEvent | undefined {
  return events.find(
    (e) =>
      e.type === 'succeeded' || e.type === 'failed' || e.type === 'cancelled',
  );
}
