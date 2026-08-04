import { describe, expect, it } from 'vitest';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import type { ExperimentRunEvent } from '@educanvas/agent-core';
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

function makeAdapter(port: MockDockerPort): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: defaultCodeResolver(),
    resolveInput: defaultInputResolver(),
    commitOutputs: async () => ({ artifacts: [], logs: [] }),
    dockerPort: port,
  });
}

function isTerminal(event: ExperimentRunEvent): boolean {
  return (
    event.type === 'succeeded' ||
    event.type === 'failed' ||
    event.type === 'cancelled'
  );
}

describe('terminal state machine', () => {
  it('emits started before terminal', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(0);
    const events = await drain(started);

    const startedIdx = events.findIndex((e) => e.type === 'started');
    const terminalIdx = events.findIndex(isTerminal);
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(terminalIdx).toBeGreaterThan(startedIdx);
  });

  it('emits at most one terminal event', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(0);
    const events = await drain(started);

    const terminals = events.filter(isTerminal);
    expect(terminals).toHaveLength(1);
  });

  it('emits failed on non-zero exit code', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(1);
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('execution_failed');
    }
  });

  it('emits succeeded on zero exit code with no outputs', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(0);
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('succeeded');
  });

  it('streams output events between started and terminal', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.emitStdout('line one\n');
    port.process.emitStderr('warning\n');
    port.process.close(0);
    const events = await drain(started);

    const kinds = events.filter((e) => e.type === 'output');
    expect(kinds.some((e) => e.type === 'output' && e.kind === 'stdout')).toBe(
      true,
    );
    expect(kinds.some((e) => e.type === 'output' && e.kind === 'stderr')).toBe(
      true,
    );
  });

  it('maps duration timeout to experiment_timeout, never cancelled', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: defaultCodeResolver(),
      resolveInput: defaultInputResolver(),
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });
    const { signal } = makeAbortSignal();
    const run = makeRun({
      resourceBudget: {
        ...makeRun().resourceBudget,
        maxDurationMs: 20,
      },
    });

    const beganAt = performance.now();
    const started = await startRun(adapter.execute(run, signal));
    // The process never exits: only the runner's timeout can end the run.
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('experiment_timeout');
    }
    expect(performance.now() - beganAt).toBeLessThan(500);
    // Timeout must force-remove the container.
    expect(port.rmCalls).toContain('exp-run-001');
  });

  it('keeps timeout as the first terminal reason when abort races cleanup', async () => {
    const port = makeMockDockerPort();
    let releaseCleanup!: () => void;
    const cleanupPending = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    port.dockerRmForce = ({ containerName }) => {
      port.rmCalls.push(containerName);
      return cleanupPending;
    };
    const adapter = makeAdapter(port);
    const { signal, abort } = makeAbortSignal();
    const run = makeRun({
      resourceBudget: {
        ...makeRun().resourceBudget,
        maxDurationMs: 20,
      },
    });

    const started = await startRun(adapter.execute(run, signal));
    await new Promise((resolve) => setTimeout(resolve, 30));
    abort();
    releaseCleanup();
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('experiment_timeout');
    }
  });
});

describe('abort and cancellation', () => {
  it('emits cancelled when the signal aborts during the run', async () => {
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
      expect(terminal.result.failureCode).toBeNull();
    }
  });

  it('returns immediately if signal already aborted', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal, abort } = makeAbortSignal();
    abort();

    const events: ExperimentRunEvent[] = [];
    for await (const event of adapter.execute(makeRun(), signal)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('cancelled');
    // Nothing may be spawned for a run that is already cancelled.
    expect(port.runCalls).toHaveLength(0);
  });
});
