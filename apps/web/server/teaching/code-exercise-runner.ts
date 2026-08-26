import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type {
  ExperimentFailureCode,
  ExperimentRun,
  ExperimentRuntimePort,
  ModelAbortSignal,
} from '@educanvas/agent-core';
import {
  CpuExperimentAdapter,
  createDefaultDockerProcessPort,
  sha256hex,
} from '@educanvas/experiment-runtime';

const SYNTHETIC_INPUT = new TextEncoder().encode('0');
const SYNTHETIC_INPUT_CHECKSUM = sha256hex(SYNTHETIC_INPUT);

export interface CodeExerciseRunResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  stdout: string;
  stderr: string;
  failureCode: ExperimentFailureCode | null;
}

function createRuntime(source: Uint8Array): ExperimentRuntimePort {
  const checksum = sha256hex(source);
  return new CpuExperimentAdapter({
    dockerPort: createDefaultDockerProcessPort(),
    resolveCode: async () => ({ bytes: source, checksum }),
    resolveInput: async () => ({
      bytes: SYNTHETIC_INPUT,
      checksum: SYNTHETIC_INPUT_CHECKSUM,
      byteSize: SYNTHETIC_INPUT.byteLength,
    }),
    commitOutputs: async () => ({ artifacts: [], logs: [] }),
  });
}

/** 执行学生代码的唯一 Web 组合根：固定 Python、无网络并使用硬资源上限。 */
export async function runCodeExercise(input: {
  notebookId: string;
  source: string;
  signal: ModelAbortSignal;
  runtime?: ExperimentRuntimePort;
}): Promise<CodeExerciseRunResult> {
  const source = new TextEncoder().encode(input.source);
  const codeHash = createHash('sha256').update(source).digest('hex');
  const runId = randomUUID();
  const run: ExperimentRun = {
    runId,
    notebookId: input.notebookId,
    codeVersionId: `submission:${codeHash.slice(0, 24)}`,
    codeHash,
    environmentId: 'cpu-python-3.11',
    inputs: [
      {
        mountName: 'exercise',
        artifactId: 'code-exercise-input',
        artifactVersionId: 'code-exercise-input:v1',
        mimeType: 'text/plain',
        checksum: SYNTHETIC_INPUT_CHECKSUM,
        byteSize: SYNTHETIC_INPUT.byteLength,
      },
    ],
    dependencies: [{ name: 'python', version: '3.11.15' }],
    randomSeed: 0,
    resourceBudget: {
      maxDurationMs: 3_000,
      maxMemoryMiB: 128,
      maxProcesses: 32,
      maxStdoutBytes: 16_384,
      maxLogBytes: 16_384,
      maxOutputBytes: 1_024,
      maxOutputFiles: 1,
    },
  };

  let stdout = '';
  let stderr = '';
  let terminal: CodeExerciseRunResult | null = null;
  for await (const event of (input.runtime ?? createRuntime(source)).execute(
    run,
    input.signal,
  )) {
    if (event.type === 'output') {
      if (event.kind === 'stdout') stdout += event.content;
      else stderr += event.content;
      continue;
    }
    if (
      event.type === 'succeeded' ||
      event.type === 'failed' ||
      event.type === 'cancelled'
    ) {
      terminal = {
        status: event.type,
        stdout,
        stderr,
        failureCode: event.result.failureCode,
      };
    }
  }
  return (
    terminal ?? {
      status: 'failed',
      stdout,
      stderr,
      failureCode: 'execution_failed',
    }
  );
}
