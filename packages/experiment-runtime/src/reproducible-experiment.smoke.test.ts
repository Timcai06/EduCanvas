/** U16: two-run deterministic experiment and real isolation/terminal evidence. */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExperimentRun, ExperimentRunEvent } from '@educanvas/agent-core';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import { createDefaultDockerProcessPort } from './docker-process-port';
import { findEnvironment } from './environment-whitelist';
import { sha256hex } from './run-materializer';

const IMAGE = findEnvironment('cpu-python-3.11')!.dockerImage;
const CODE_BYTES = readFixture('../fixtures/u16/experiment.py');
const INPUT_BYTES = readFixture('../fixtures/u16/input.csv');
const EXPECTED_METRICS = new TextEncoder().encode(
  '{"gpu_visible":false,"intercept":1.0,"network_blocked":true,"random_seed":20260804,"rmse":0.0,"slope":2.0,"train_indices":[0,2,3,4]}\n',
);
const EXPECTED_PREDICTIONS = new TextEncoder().encode(
  [
    'x,actual,prediction',
    '0.0,1.0,1.0',
    '1.0,3.0,3.0',
    '2.0,5.0,5.0',
    '3.0,7.0,7.0',
    '4.0,9.0,9.0',
    '5.0,11.0,11.0',
    '',
  ].join('\n'),
);

const skip = !dockerReady();

describe.skipIf(skip)(
  'U16 reproducible experiment smoke',
  { timeout: 120_000 },
  () => {
    afterAll(() => {
      expect(leftoverU16Containers()).toEqual([]);
    });

    it('produces byte-identical bounded outputs in two clean runs', async () => {
      const first = await execute('u16-repro-1', CODE_BYTES);
      const second = await execute('u16-repro-2', CODE_BYTES);

      expect(first.terminal.type).toBe('succeeded');
      expect(second.terminal.type).toBe('succeeded');
      expect(serialiseFiles(first.files)).toEqual(serialiseFiles(second.files));
      expect(first.files.get('metrics.json')).toEqual(EXPECTED_METRICS);
      expect(first.files.get('predictions.csv')).toEqual(EXPECTED_PREDICTIONS);

      const metrics = JSON.parse(
        new TextDecoder().decode(first.files.get('metrics.json')),
      ) as { network_blocked: boolean; gpu_visible: boolean };
      expect(metrics.network_blocked).toBe(true);
      expect(metrics.gpu_visible).toBe(false);

      if (first.terminal.type === 'succeeded') {
        expect(first.terminal.provenance.codeHash).toBe(sha256hex(CODE_BYTES));
        expect(first.terminal.provenance.inputs[0]?.checksum).toBe(
          sha256hex(INPUT_BYTES),
        );
        expect(first.terminal.provenance.randomSeed).toBe(20260804);
        expect(
          first.terminal.result.outputs.map((output) => output.checksum),
        ).toEqual([
          sha256hex(EXPECTED_METRICS),
          sha256hex(EXPECTED_PREDICTIONS),
        ]);
      }
    });

    it('maps timeout, cancellation, and stdout quota to distinct terminals', async () => {
      const timeout = await execute(
        'u16-timeout',
        new TextEncoder().encode('while True:\n    pass\n'),
        { maxDurationMs: 300 },
      );
      expect(failureCode(timeout.terminal)).toBe('experiment_timeout');

      const quota = await execute(
        'u16-quota',
        new TextEncoder().encode(
          'while True:\n    print("x" * 1000, flush=True)\n',
        ),
        { maxStdoutBytes: 4096 },
      );
      expect(failureCode(quota.terminal)).toBe('resource_quota_exceeded');

      const cancelled = await executeCancelled('u16-cancel');
      expect(cancelled.type).toBe('cancelled');
    });
  },
);

interface Execution {
  readonly terminal: ExperimentRunEvent;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

async function execute(
  runId: string,
  codeBytes: Uint8Array,
  budgetOverrides: Partial<ExperimentRun['resourceBudget']> = {},
): Promise<Execution> {
  const committedFiles = new Map<string, Uint8Array>();
  const adapter = createAdapter(codeBytes, committedFiles);
  const controller = new AbortController();
  const terminal = await collectTerminal(
    adapter.execute(
      makeRun(runId, codeBytes, budgetOverrides),
      controller.signal,
    ),
  );
  return { terminal, files: committedFiles };
}

async function executeCancelled(runId: string): Promise<ExperimentRunEvent> {
  const code = new TextEncoder().encode('while True:\n    pass\n');
  const adapter = createAdapter(code, new Map());
  const controller = new AbortController();
  const iterator = adapter
    .execute(makeRun(runId, code), controller.signal)
    [Symbol.asyncIterator]();
  const started = await iterator.next();
  expect(started.value?.type).toBe('started');
  controller.abort();
  const events: ExperimentRunEvent[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
  }
  const terminal = events.find((event) => event.type === 'cancelled');
  if (!terminal) throw new Error('U16 cancellation produced no terminal event');
  return terminal;
}

function createAdapter(
  codeBytes: Uint8Array,
  committedFiles: Map<string, Uint8Array>,
): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: async () => ({
      bytes: codeBytes,
      checksum: sha256hex(codeBytes),
    }),
    resolveInput: async () => ({
      bytes: INPUT_BYTES,
      checksum: sha256hex(INPUT_BYTES),
      byteSize: INPUT_BYTES.byteLength,
    }),
    commitOutputs: async (files, context) => {
      for (const file of files) {
        committedFiles.set(file.relativePath, Uint8Array.from(file.bytes));
      }
      return {
        artifacts: files.map((file, index) => ({
          artifactId: `artifact-${context.runId}-${index}`,
          artifactVersionId: `version-${context.runId}-${index}`,
          kind: 'experiment_output',
          mimeType: file.mimeType,
          checksum: file.checksum,
          byteSize: file.byteSize,
        })),
        logs: [],
      };
    },
    dockerPort: createDefaultDockerProcessPort(),
  });
}

function makeRun(
  runId: string,
  codeBytes: Uint8Array,
  budgetOverrides: Partial<ExperimentRun['resourceBudget']> = {},
): ExperimentRun {
  return {
    runId,
    notebookId: 'u16-notebook',
    codeVersionId: 'u16-code-v1',
    codeHash: sha256hex(codeBytes),
    environmentId: 'cpu-python-3.11',
    inputs: [
      {
        mountName: 'data',
        artifactId: 'u16-input',
        artifactVersionId: 'u16-input-v1',
        mimeType: 'text/csv',
        checksum: sha256hex(INPUT_BYTES),
        byteSize: INPUT_BYTES.byteLength,
      },
    ],
    dependencies: [{ name: 'python', version: '3.11.15' }],
    randomSeed: 20260804,
    resourceBudget: {
      maxDurationMs: 10_000,
      maxMemoryMiB: 256,
      maxProcesses: 32,
      maxStdoutBytes: 16 * 1024,
      maxLogBytes: 16 * 1024,
      maxOutputBytes: 64 * 1024,
      maxOutputFiles: 4,
      ...budgetOverrides,
    },
  };
}

async function collectTerminal(
  events: AsyncIterable<ExperimentRunEvent>,
): Promise<ExperimentRunEvent> {
  let terminal: ExperimentRunEvent | undefined;
  for await (const event of events) {
    if (
      event.type === 'succeeded' ||
      event.type === 'failed' ||
      event.type === 'cancelled'
    ) {
      terminal = event;
    }
  }
  if (!terminal) throw new Error('U16 run produced no terminal event');
  return terminal;
}

function failureCode(event: ExperimentRunEvent): string | null {
  return event.type === 'failed' ? event.result.failureCode : null;
}

function serialiseFiles(files: ReadonlyMap<string, Uint8Array>) {
  return [...files.entries()].map(([path, bytes]) => ({
    path,
    byteSize: bytes.byteLength,
    checksum: sha256hex(bytes),
  }));
}

function readFixture(relativePath: string): Uint8Array {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)));
}

function dockerReady(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}']);
    execFileSync('docker', ['image', 'inspect', IMAGE]);
    return true;
  } catch {
    return false;
  }
}

function leftoverU16Containers(): string[] {
  try {
    return execFileSync('docker', [
      'ps',
      '-a',
      '--filter',
      'name=^exp-u16-',
      '--format',
      '{{.Names}}',
    ])
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}
