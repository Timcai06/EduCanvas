import { describe, expect, it } from 'vitest';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import {
  makeRun,
  makeAbortSignal,
  makeMockDockerPort,
  defaultCodeResolver,
  defaultInputResolver,
  startRun,
  drain,
  getTerminalEvent,
  type MockDockerPort,
} from './test-helpers';

function makeAdapter(
  port: MockDockerPort,
  clock?: () => Date,
): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: defaultCodeResolver(),
    resolveInput: defaultInputResolver(),
    commitOutputs: async () => ({ artifacts: [], logs: [] }),
    dockerPort: port,
    clock,
  });
}

describe('provenance timestamps', () => {
  it('records finishedAt >= startedAt with an injected clock', async () => {
    let now = Date.parse('2026-06-01T00:00:00.000Z');
    const clock = () => new Date((now += 1000));

    const port = makeMockDockerPort();
    const adapter = makeAdapter(port, clock);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(0);
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('succeeded');
    if (terminal?.type === 'succeeded') {
      const startedAt = Date.parse(terminal.provenance.startedAt);
      const finishedAt = Date.parse(terminal.provenance.finishedAt);
      expect(Number.isNaN(startedAt)).toBe(false);
      expect(Number.isNaN(finishedAt)).toBe(false);
      expect(finishedAt).toBeGreaterThanOrEqual(startedAt);
    }
  });

  it('records startedAt and finishedAt with the injected clock on failure', async () => {
    let now = Date.parse('2026-06-01T00:00:00.000Z');
    const clock = () => new Date((now += 500));

    const port = makeMockDockerPort();
    const adapter = makeAdapter(port, clock);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(1);
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.provenance.startedAt).toBe('2026-06-01T00:00:00.500Z');
      expect(terminal.provenance.finishedAt).toBe('2026-06-01T00:00:01.000Z');
      expect(terminal.provenance.failureCode).toBe('execution_failed');
    }
  });

  it('records a cancelled provenance without a failure code', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal, abort } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    abort();
    port.process.close(0);
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('cancelled');
    if (terminal?.type === 'cancelled') {
      expect(terminal.provenance.terminalStatus).toBe('cancelled');
      expect(terminal.provenance.failureCode).toBeNull();
      expect(terminal.provenance.outputs).toHaveLength(0);
      expect(terminal.provenance.startedAt).toBeTruthy();
      expect(terminal.provenance.finishedAt).toBeTruthy();
    }
  });

  it('keeps provenance consistent with the terminal event', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(0);
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('succeeded');
    if (terminal?.type === 'succeeded') {
      expect(terminal.provenance.runId).toBe(terminal.result.runId);
      expect(terminal.provenance.terminalStatus).toBe('succeeded');
      expect(terminal.provenance.codeHash).toBe(makeRun().codeHash);
      expect(terminal.provenance.environmentId).toBe('cpu-python-3.11');
      expect(JSON.stringify(terminal.provenance.outputs)).toBe(
        JSON.stringify(terminal.result.outputs),
      );
    }
  });
});
