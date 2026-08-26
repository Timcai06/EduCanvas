import type {
  ExperimentRun,
  ExperimentRunEvent,
  ExperimentRuntimePort,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runCodeExercise } from './code-exercise-runner';

class RecordingRuntime implements ExperimentRuntimePort {
  run: ExperimentRun | null = null;

  constructor(private readonly events: readonly ExperimentRunEvent[]) {}

  async *execute(run: ExperimentRun): AsyncIterable<ExperimentRunEvent> {
    this.run = run;
    yield* this.events;
  }
}

describe('runCodeExercise', () => {
  it('固定无网络 Python 环境和严格资源预算并回显有界输出', async () => {
    const runtime = new RecordingRuntime([
      { type: 'started' },
      { type: 'output', kind: 'stdout', content: '79.0\n' },
      {
        type: 'succeeded',
        result: {
          runId: 'placeholder',
          status: 'succeeded',
          failureCode: null,
          outputs: [],
          logs: [],
        },
        provenance: {} as never,
      },
    ]);
    const result = await runCodeExercise({
      notebookId: 'notebook-1',
      source: 'print(79.0)',
      signal: new AbortController().signal,
      runtime,
    });

    expect(result).toMatchObject({ status: 'succeeded', stdout: '79.0\n' });
    expect(runtime.run).toMatchObject({
      environmentId: 'cpu-python-3.11',
      dependencies: [{ name: 'python', version: '3.11.15' }],
      resourceBudget: {
        maxDurationMs: 3_000,
        maxMemoryMiB: 128,
        maxStdoutBytes: 16_384,
      },
    });
  });

  it('把沙箱失败码与 stderr 作为稳定结果返回', async () => {
    const runtime = new RecordingRuntime([
      { type: 'output', kind: 'stderr', content: 'SyntaxError\n' },
      {
        type: 'failed',
        result: {
          runId: 'placeholder',
          status: 'failed',
          failureCode: 'execution_failed',
          outputs: [],
          logs: [],
        },
        provenance: {} as never,
      },
    ]);

    await expect(
      runCodeExercise({
        notebookId: 'notebook-1',
        source: 'average = ___',
        signal: new AbortController().signal,
        runtime,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      stderr: 'SyntaxError\n',
      failureCode: 'execution_failed',
    });
  });
});
