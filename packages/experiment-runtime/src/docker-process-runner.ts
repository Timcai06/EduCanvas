/**
 * Docker process runner — manages container lifecycle: spawn, stream
 * stdout/stderr, enforce quotas, handle timeout/cancellation, and
 * cleanup via `docker rm -f`. The runner owns the process and ensures
 * cleanup happens in all code paths.
 *
 * U14-R2 changes:
 * - Uses DockerProcessPort injection (no direct import/spawn anywhere)
 * - Quota exceeded immediately calls docker rm -f (not wait for close)
 * - Defines internal termination reasons with strict state mapping
 * - Output events are pushed to a real AsyncQueue (not emit callbacks)
 * - Oversized content is split into chunks, never truncated
 */

import type {
  ExperimentResourceBudget,
  ExperimentFailureCode,
  ModelAbortSignal,
} from '@educanvas/agent-core';
import type {
  DockerChildProcess,
  DockerProcessPort,
} from './docker-process-port';
import type { EventQueue } from './event-queue';

const MAX_EVENT_CONTENT_BYTES = 65536;

/**
 * Internal termination reasons before mapping to ExperimentFailureCode.
 * Strict state mapping:
 * - timeout          → experiment_timeout (NOT experiment_cancelled)
 * - user_cancel      → experiment_cancelled
 * - stdout_quota     → resource_quota_exceeded
 * - stderr_quota     → resource_quota_exceeded
 * - process_exit     → execution_failed (or succeeded when exitCode is 0)
 * - spawn_error      → execution_failed
 */
export type TerminationReason =
  | 'user_cancel'
  | 'timeout'
  | 'stdout_quota'
  | 'stderr_quota'
  | 'process_exit'
  | 'spawn_error';

export interface RunResult {
  readonly exitCode: number;
  readonly terminationReason: TerminationReason;
  readonly quotaType: 'stdout' | 'stderr' | null;
}

export interface DockerProcessRunnerOptions {
  readonly command: readonly string[];
  readonly budget: ExperimentResourceBudget;
  readonly containerName: string;
  readonly dockerPort: DockerProcessPort;
  readonly signal: ModelAbortSignal;
  readonly queue: EventQueue;
}

/**
 * Split oversized content into multiple events instead of truncating.
 * Each returned chunk is at most maxBytes UTF-8 bytes. Multibyte
 * characters may be split across chunk boundaries; the schema only
 * bounds content length, so a partial trailing code unit is acceptable
 * for streaming display purposes.
 */
export function splitIntoChunks(text: string, maxBytes: number): string[] {
  if (maxBytes <= 0) return [];
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return [text];

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf-8');
    if (current && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Map internal termination reason to ExperimentFailureCode.
 * Strict state mapping:
 * - timeout → experiment_timeout (NOT experiment_cancelled)
 * - user_cancel → experiment_cancelled
 * - stdout_quota / stderr_quota → resource_quota_exceeded
 * - process_exit / spawn_error → execution_failed
 */
export function mapTerminationToFailureCode(
  reason: TerminationReason,
): ExperimentFailureCode {
  switch (reason) {
    case 'timeout':
      return 'experiment_timeout';
    case 'user_cancel':
      return 'experiment_cancelled';
    case 'stdout_quota':
    case 'stderr_quota':
      return 'resource_quota_exceeded';
    case 'process_exit':
    case 'spawn_error':
      return 'execution_failed';
  }
}

export async function runDockerContainer(
  options: DockerProcessRunnerOptions,
): Promise<RunResult> {
  const { command, budget, containerName, dockerPort, signal, queue } = options;

  if (command.length === 0) {
    throw new Error('Docker command is empty');
  }

  if (signal.aborted) {
    return { exitCode: 1, terminationReason: 'user_cancel', quotaType: null };
  }

  let proc: DockerChildProcess;
  try {
    proc = dockerPort.dockerRun({ command, signal });
  } catch {
    await dockerPort.dockerRmForce({ containerName });
    return { exitCode: 1, terminationReason: 'spawn_error', quotaType: null };
  }

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let quotaType: 'stdout' | 'stderr' | null = null;
  let claimedReason: TerminationReason | null = null;
  let cleanedUp = false;

  const claimTermination = (reason: TerminationReason): boolean => {
    if (claimedReason !== null) return false;
    claimedReason = reason;
    return true;
  };

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    await dockerPort.dockerRmForce({ containerName });
  };

  let resolveExit!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  proc.on('close', (code) => {
    if (claimTermination('process_exit')) resolveExit(code ?? 1);
  });
  proc.on('error', () => {
    if (claimTermination('spawn_error')) resolveExit(1);
  });

  const terminate = (reason: TerminationReason): void => {
    if (!claimTermination(reason)) return;
    void cleanup().finally(() => resolveExit(1));
  };

  const handleAbort = (): void => terminate('user_cancel');
  signal.addEventListener('abort', handleAbort, { once: true });

  // maxDurationMs is a hard execution budget. Cleanup has its own bounded
  // timeout in DockerProcessPort and must not extend the run allowance.
  const timeoutHandle = setTimeout(() => {
    terminate('timeout');
  }, budget.maxDurationMs);

  proc.stdout?.on('data', (chunk: Buffer) => {
    if (claimedReason !== null) return;
    const text = chunk.toString('utf-8');
    stdoutBytes += Buffer.byteLength(text, 'utf-8');

    if (stdoutBytes > budget.maxStdoutBytes) {
      // Quota exceeded: remove the container immediately without waiting
      // for the process to close on its own.
      quotaType = 'stdout';
      terminate('stdout_quota');
      return;
    }

    for (const part of splitIntoChunks(text, MAX_EVENT_CONTENT_BYTES)) {
      queue.push({ type: 'output', kind: 'stdout', content: part });
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    if (claimedReason !== null) return;
    const text = chunk.toString('utf-8');
    stderrBytes += Buffer.byteLength(text, 'utf-8');

    if (stderrBytes > budget.maxLogBytes) {
      quotaType = 'stderr';
      terminate('stderr_quota');
      return;
    }

    for (const part of splitIntoChunks(text, MAX_EVENT_CONTENT_BYTES)) {
      queue.push({ type: 'output', kind: 'stderr', content: part });
    }
  });

  // `started` is the public readiness boundary: once observed, all process
  // output, exit, abort, timeout and quota listeners are already installed.
  queue.push({ type: 'started' });

  const exitCode = await exitPromise;
  clearTimeout(timeoutHandle);
  signal.removeEventListener('abort', handleAbort);

  // Cleanup on abnormal paths. On a normal exit --rm removes the container.
  if (claimedReason !== 'process_exit') {
    await cleanup();
  }

  return {
    exitCode,
    terminationReason: claimedReason ?? 'spawn_error',
    quotaType,
  };
}

/**
 * Convenience guard used by consumers to check whether a RunResult is a
 * clean success. A process may exit 0 even when killed externally, so the
 * termination reason decides the terminal state, not the raw exit code.
 */
export function isCleanRunResult(result: RunResult): boolean {
  return result.terminationReason === 'process_exit' && result.exitCode === 0;
}
