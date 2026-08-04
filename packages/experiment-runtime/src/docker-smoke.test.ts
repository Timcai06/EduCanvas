/**
 * Real Docker smoke tests for the CPU experiment adapter.
 *
 * These tests run the full adapter against the real docker daemon using the
 * pinned python:3.11-slim image. They are skipped automatically when docker
 * or the pinned image is unavailable (e.g. CI without a daemon).
 *
 * R2-10 coverage:
 * - success: real code writes an output file that is verified and committed
 * - network isolation: DNS resolution fails inside the container
 * - duration timeout maps to experiment_timeout
 * - infinite stdout trips the quota and the container is force-removed
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import { createDefaultDockerProcessPort } from './docker-process-port';
import { sha256hex } from './run-materializer';
import { findEnvironment } from './environment-whitelist';
import type { ExperimentRun, ExperimentRunEvent } from '@educanvas/agent-core';
import { makeAbortSignal, getTerminalEvent } from './test-helpers';

const DOCKER_IMAGE = findEnvironment('cpu-python-3.11')!.dockerImage;

function dockerReady(): boolean {
  try {
    const version = execFileSync('docker', [
      'version',
      '--format',
      '{{.Server.Version}}',
    ]).toString();
    if (!version.trim()) return false;
    execFileSync('docker', ['image', 'inspect', DOCKER_IMAGE]);
    return true;
  } catch {
    return false;
  }
}

function leftoverContainers(): string[] {
  try {
    const out = execFileSync('docker', [
      'ps',
      '-a',
      '--filter',
      'name=^exp-',
      '--format',
      '{{.Names}}',
    ]).toString();
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const skip = !dockerReady();

let runCounter = 0;
function nextRun(codeSource: string, overrides: Partial<ExperimentRun> = {}) {
  runCounter += 1;
  const bytes = new TextEncoder().encode(codeSource);
  const run: ExperimentRun = {
    runId: `smoke-${Date.now()}-${runCounter}`,
    notebookId: 'smoke-nb',
    codeVersionId: 'smoke-code-v1',
    codeHash: sha256hex(bytes),
    environmentId: 'cpu-python-3.11',
    inputs: [
      {
        mountName: 'data',
        artifactId: 'smoke-art',
        artifactVersionId: 'smoke-art-v1',
        mimeType: 'text/csv',
        checksum: sha256hex(new TextEncoder().encode('a,b\n1,2')),
        byteSize: 7,
      },
    ],
    dependencies: [{ name: 'python', version: '3.11.15' }],
    randomSeed: 1,
    resourceBudget: {
      maxDurationMs: 10_000,
      maxMemoryMiB: 256,
      maxProcesses: 64,
      maxStdoutBytes: 1024 * 1024,
      maxLogBytes: 2 * 1024 * 1024,
      maxOutputBytes: 10 * 1024 * 1024,
      maxOutputFiles: 10,
    },
    ...overrides,
  };
  return { run, codeBytes: bytes };
}

async function runToTerminal(
  adapter: CpuExperimentAdapter,
  run: ExperimentRun,
): Promise<{ events: ExperimentRunEvent[]; terminal: ExperimentRunEvent }> {
  const { signal } = makeAbortSignal();
  const events: ExperimentRunEvent[] = [];
  for await (const event of adapter.execute(run, signal)) {
    events.push(event);
  }
  const terminal = getTerminalEvent(events);
  if (!terminal) throw new Error('No terminal event');
  return { events, terminal };
}

function dockerWriteOutput(relativePath: string): string {
  return [
    'import pathlib',
    `pathlib.Path('/experiment/output/${relativePath}').write_text('hello smoke')`,
  ].join('\n');
}

describe.skipIf(skip)('docker smoke tests', { timeout: 120_000 }, () => {
  afterAll(() => {
    const leftovers = leftoverContainers();
    expect(leftovers).toEqual([]);
  });

  it('runs real python, verifies output, and registers the artifact', async () => {
    const { run, codeBytes } = nextRun(dockerWriteOutput('result.txt'));
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: codeBytes,
        checksum: sha256hex(codeBytes),
      }),
      resolveInput: async () => {
        const bytes = new TextEncoder().encode('a,b\n1,2');
        return { bytes, checksum: sha256hex(bytes), byteSize: 7 };
      },
      commitOutputs: async (files, context) => ({
        artifacts: files.map((file, i) => ({
          artifactId: `smoke-out-${context.runId}-${i}`,
          artifactVersionId: `${context.runId}-${i}-v1`,
          kind: 'experiment_output',
          mimeType: file.mimeType,
          checksum: file.checksum,
          byteSize: file.byteSize,
        })),
        logs: [],
      }),
      dockerPort: createDefaultDockerProcessPort(),
    });

    const { terminal } = await runToTerminal(adapter, run);
    expect(terminal.type).toBe('succeeded');
    if (terminal.type === 'succeeded') {
      expect(terminal.result.outputs).toHaveLength(1);
      const artifact = terminal.result.outputs[0]!;
      expect(artifact.mimeType).toBe('text/plain');
      expect(artifact.byteSize).toBe(
        new TextEncoder().encode('hello smoke').byteLength,
      );
      expect(artifact.checksum).toBe(
        sha256hex(new TextEncoder().encode('hello smoke')),
      );
    }
  });

  it('blocks network access inside the container', async () => {
    const code = [
      'import socket',
      'try:',
      '    socket.getaddrinfo("example.com", 80)',
      '    print("DNS_OK")',
      'except Exception as exc:',
      '    print("DNS_FAIL", file=__import__("sys").stderr)',
    ].join('\n');
    const { run, codeBytes } = nextRun(code);
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: codeBytes,
        checksum: sha256hex(codeBytes),
      }),
      resolveInput: async () => {
        const bytes = new TextEncoder().encode('a,b\n1,2');
        return { bytes, checksum: sha256hex(bytes), byteSize: 7 };
      },
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: createDefaultDockerProcessPort(),
    });

    const { events, terminal } = await runToTerminal(adapter, run);
    expect(terminal.type).toBe('succeeded');
    const stderr = events
      .filter((e) => e.type === 'output' && e.kind === 'stderr')
      .map((e) => (e.type === 'output' ? e.content : ''))
      .join('');
    expect(stderr).toContain('DNS_FAIL');
    // The failure must be a network resolution problem, not a reachable host.
    expect(stderr).not.toContain('DNS_OK');
  });

  it('times out an infinite loop and maps to experiment_timeout', async () => {
    const { run, codeBytes } = nextRun('while True:\n    pass', {
      resourceBudget: {
        maxDurationMs: 2_000,
        maxMemoryMiB: 256,
        maxProcesses: 64,
        maxStdoutBytes: 1024 * 1024,
        maxLogBytes: 2 * 1024 * 1024,
        maxOutputBytes: 10 * 1024 * 1024,
        maxOutputFiles: 10,
      },
    });
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: codeBytes,
        checksum: sha256hex(codeBytes),
      }),
      resolveInput: async () => {
        const bytes = new TextEncoder().encode('a,b\n1,2');
        return { bytes, checksum: sha256hex(bytes), byteSize: 7 };
      },
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: createDefaultDockerProcessPort(),
    });

    const { terminal } = await runToTerminal(adapter, run);
    expect(terminal.type).toBe('failed');
    if (terminal.type === 'failed') {
      expect(terminal.result.failureCode).toBe('experiment_timeout');
    }
  });

  it('trips the stdout quota on infinite output and force-removes the container', async () => {
    const code = 'while True:\n    print("x" * 1000, flush=True)';
    const { run, codeBytes } = nextRun(code, {
      resourceBudget: {
        maxDurationMs: 10_000,
        maxMemoryMiB: 256,
        maxProcesses: 64,
        maxStdoutBytes: 8192,
        maxLogBytes: 2 * 1024 * 1024,
        maxOutputBytes: 10 * 1024 * 1024,
        maxOutputFiles: 10,
      },
    });
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: codeBytes,
        checksum: sha256hex(codeBytes),
      }),
      resolveInput: async () => {
        const bytes = new TextEncoder().encode('a,b\n1,2');
        return { bytes, checksum: sha256hex(bytes), byteSize: 7 };
      },
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: createDefaultDockerProcessPort(),
    });

    const { terminal } = await runToTerminal(adapter, run);
    expect(terminal.type).toBe('failed');
    if (terminal.type === 'failed') {
      expect(terminal.result.failureCode).toBe('resource_quota_exceeded');
    }
  });

  it('leaves no containers behind after the run (docker ps -a clean)', () => {
    // afterAll performs the authoritative check; this guards the ordering.
    expect(leftoverContainers()).toEqual([]);
  });
});
