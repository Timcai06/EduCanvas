/**
 * Docker process port — abstraction over Docker CLI operations.
 * All docker run and docker rm -f commands go through this port
 * to enable testing and dependency injection.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { type Readable } from 'node:stream';
import type { ModelAbortSignal } from '@educanvas/agent-core';

/**
 * Minimal surface the adapter needs from a docker run child process.
 * Deliberately narrower than ChildProcess so tests can mock it easily.
 */
export interface DockerChildProcess {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface DockerRunOptions {
  readonly command: readonly string[];
  readonly signal?: ModelAbortSignal;
}

export interface DockerRmForceOptions {
  readonly containerName: string;
}

export interface DockerProcessPort {
  dockerRun(options: DockerRunOptions): DockerChildProcess;
  dockerRmForce(options: DockerRmForceOptions): Promise<void>;
}

function dockerRmForceDefault(
  containerName: string,
  timeoutMs: number = 5000,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve();
    };
    const proc = spawn('docker', ['rm', '-f', containerName], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.on('close', finish);
    proc.on('error', finish);
    timeoutHandle = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
      finish();
    }, timeoutMs);
  });
}

export function createDefaultDockerProcessPort(): DockerProcessPort {
  return {
    dockerRun({ command, signal }) {
      if (command.length === 0) {
        throw new Error('Docker command is empty');
      }
      // ModelAbortSignal is structurally compatible with AbortSignal for
      // spawn's needs (addEventListener on 'abort'); the composition root
      // passes a real AbortSignal in practice.
      return spawn(command[0]!, command.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: signal as AbortSignal | undefined,
        detached: false,
      });
    },
    dockerRmForce({ containerName }) {
      return dockerRmForceDefault(containerName);
    },
  };
}
