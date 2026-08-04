import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import type { ExperimentRun, ExperimentRunEvent } from '@educanvas/agent-core';
import type { OutputCommitterFn } from './output-committer';
import { sha256hex } from './run-materializer';
import {
  makeRun,
  makeAbortSignal,
  makeMockDockerPort,
  defaultCodeResolver,
  defaultInputResolver,
  collectEvents,
  getTerminalEvent,
  type MockDockerPort,
} from './test-helpers';

/** Parse the host output dir out of the recorded docker run command. */
function extractOutputDir(port: MockDockerPort): string {
  const cmd = port.runCalls[0]!.command;
  const volumeIdx = cmd.findIndex(
    (arg) => typeof arg === 'string' && arg.endsWith('/experiment/output:rw'),
  );
  expect(volumeIdx).toBeGreaterThan(-1);
  return (cmd[volumeIdx] as string).split(':')[0]!;
}

function makeAdapter(
  port: MockDockerPort,
  commitOutputs: OutputCommitterFn,
): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: defaultCodeResolver(),
    resolveInput: defaultInputResolver(),
    commitOutputs,
    dockerPort: port,
  });
}

async function runSuccessWithFile(
  commitOutputs: OutputCommitterFn,
  fileName = 'result.txt',
  content = 'hello output',
): Promise<{ events: ExperimentRunEvent[]; port: MockDockerPort }> {
  const port = makeMockDockerPort();
  const adapter = makeAdapter(port, commitOutputs);
  const { signal } = makeAbortSignal();

  const events: ExperimentRunEvent[] = [];
  const iter = adapter.execute(makeRun(), signal)[Symbol.asyncIterator]();

  events.push((await iter.next()).value as ExperimentRunEvent);
  expect(events[0]?.type).toBe('started');

  const outputDir = extractOutputDir(port);
  await writeFile(path.join(outputDir, fileName), content);

  port.process.close(0);

  for (;;) {
    const next = await iter.next();
    if (next.done) break;
    events.push(next.value);
  }
  return { events, port };
}

describe('success path with output registration', () => {
  it('commits verified bytes and succeeds with matching artifacts', async () => {
    const seen: { relativePath: string; bytes: Uint8Array }[] = [];
    const commitOutputs: OutputCommitterFn = async (files, context) => {
      for (const file of files) {
        seen.push({ relativePath: file.relativePath, bytes: file.bytes });
      }
      return {
        artifacts: files.map((file) => ({
          artifactId: `out-${context.runId}-${file.relativePath.replace(/[^A-Za-z0-9._-]/g, '-')}`,
          artifactVersionId: `out-${context.runId}-${file.relativePath.replace(/[^A-Za-z0-9._-]/g, '-')}-v1`,
          kind: 'experiment_output',
          mimeType: file.mimeType,
          checksum: file.checksum,
          byteSize: file.byteSize,
        })),
        logs: [],
      };
    };

    const { events } = await runSuccessWithFile(commitOutputs);
    const terminal = getTerminalEvent(events);

    expect(terminal?.type).toBe('succeeded');
    if (terminal?.type === 'succeeded') {
      expect(terminal.result.outputs).toHaveLength(1);
      expect(terminal.result.outputs[0]!.byteSize).toBe(
        new TextEncoder().encode('hello output').byteLength,
      );
      expect(terminal.result.outputs[0]!.checksum).toBe(
        sha256hex(new TextEncoder().encode('hello output')),
      );
    }

    // The committer must receive the exact verified bytes, not host paths.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.relativePath).toBe('result.txt');
    expect(new TextDecoder().decode(seen[0]!.bytes)).toBe('hello output');
  });

  it('succeeds with an empty output directory (no artifacts)', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port, async () => ({
      artifacts: [],
      logs: [],
    }));
    const { signal } = makeAbortSignal();

    const events: ExperimentRunEvent[] = [];
    const iter = adapter.execute(makeRun(), signal)[Symbol.asyncIterator]();

    events.push((await iter.next()).value as ExperimentRunEvent);
    port.process.close(0);

    for (;;) {
      const next = await iter.next();
      if (next.done) break;
      events.push(next.value);
    }

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('succeeded');
  });

  it('fails with output_validation_failed when committed checksums diverge', async () => {
    const commitOutputs: OutputCommitterFn = async (files) => ({
      artifacts: files.map((file, i) => ({
        artifactId: `out-${i}`,
        artifactVersionId: `out-${i}-v1`,
        kind: 'experiment_output',
        mimeType: file.mimeType,
        checksum: 'f'.repeat(64),
        byteSize: file.byteSize,
      })),
      logs: [],
    });

    const { events } = await runSuccessWithFile(commitOutputs);
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('output_validation_failed');
    }
  });

  it('fails with output_validation_failed when committed artifact count diverges', async () => {
    const commitOutputs: OutputCommitterFn = async (files) => ({
      artifacts: files
        .map((file) => ({
          artifactId: `out-${file.relativePath}`,
          artifactVersionId: `out-${file.relativePath}-v1`,
          kind: 'experiment_output',
          mimeType: file.mimeType,
          checksum: file.checksum,
          byteSize: file.byteSize,
        }))
        .slice(0, 0),
      logs: [],
    });

    const { events } = await runSuccessWithFile(commitOutputs);
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('output_validation_failed');
    }
  });

  it('fails when the committed MIME type diverges from verified output', async () => {
    const commitOutputs: OutputCommitterFn = async (files) => ({
      artifacts: files.map((file, i) => ({
        artifactId: `out-${i}`,
        artifactVersionId: `out-${i}-v1`,
        kind: 'experiment_output',
        mimeType: 'application/octet-stream',
        checksum: file.checksum,
        byteSize: file.byteSize,
      })),
      logs: [],
    });

    const { events } = await runSuccessWithFile(commitOutputs);
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('output_validation_failed');
    }
  });

  it('rejects a runtime-invalid artifact returned by the committer', async () => {
    const commitOutputs = (async (files) => ({
      artifacts: files.map((file) => ({
        artifactId: '../invalid',
        artifactVersionId: 'valid-v1',
        kind: 'experiment_output',
        mimeType: file.mimeType,
        checksum: file.checksum,
        byteSize: file.byteSize,
      })),
      logs: [],
    })) as OutputCommitterFn;

    const { events } = await runSuccessWithFile(commitOutputs);
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('output_validation_failed');
    }
  });

  it('fails with output_validation_failed when the committer rejects', async () => {
    const commitOutputs: OutputCommitterFn = async () => {
      throw new Error('storage backend down');
    };

    const { events } = await runSuccessWithFile(commitOutputs);
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('output_validation_failed');
      // The error internals must never leak into events.
      expect(JSON.stringify(terminal)).not.toContain('storage backend');
    }
  });

  it('fails with output_validation_failed when the output dir is missing', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port, async () => ({
      artifacts: [],
      logs: [],
    }));
    const { signal } = makeAbortSignal();

    const events: ExperimentRunEvent[] = [];
    const iter = adapter.execute(makeRun(), signal)[Symbol.asyncIterator]();
    events.push((await iter.next()).value as ExperimentRunEvent);

    const outputDir = extractOutputDir(port);
    const { rm } = await import('node:fs/promises');
    await rm(outputDir, { recursive: true, force: true });

    port.process.close(0);

    for (;;) {
      const next = await iter.next();
      if (next.done) break;
      events.push(next.value);
    }

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('output_validation_failed');
    }
  });
});
