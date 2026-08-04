import { describe, expect, it } from 'vitest';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import {
  EXPERIMENT_ENVIRONMENTS,
  findEnvironment,
} from './environment-whitelist';
import {
  makeRun,
  makeAbortSignal,
  makeMockDockerPort,
  defaultCodeResolver,
  defaultInputResolver,
  collectEvents,
  startRun,
  drain,
  getTerminalEvent,
} from './test-helpers';

function makeAdapter(port = makeMockDockerPort()): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: defaultCodeResolver(),
    resolveInput: defaultInputResolver(),
    commitOutputs: async () => ({ artifacts: [], logs: [] }),
    dockerPort: port,
  });
}

describe('environment whitelist', () => {
  it('has exactly one environment', () => {
    expect(EXPERIMENT_ENVIRONMENTS).toHaveLength(1);
  });

  it('cpu-python-3.11 uses pinned digest', () => {
    const env = findEnvironment('cpu-python-3.11');
    expect(env).toBeDefined();
    expect(env!.dockerImage).toContain('@sha256:');
  });

  it('cpu-python-3.11 only allows python dependency', () => {
    const env = findEnvironment('cpu-python-3.11');
    expect(env!.allowedDependencies).toHaveLength(1);
    expect(env!.allowedDependencies[0]!.name).toBe('python');
  });

  it('rejects unknown environment id', () => {
    expect(findEnvironment('cpu-node-22')).toBeUndefined();
    expect(findEnvironment('gpu-cuda-12')).toBeUndefined();
  });
});

describe('environment validation', () => {
  it('rejects a missing commitOutputs function at construction time', () => {
    expect(
      () =>
        new CpuExperimentAdapter({
          resolveCode: defaultCodeResolver(),
          resolveInput: defaultInputResolver(),
          commitOutputs: undefined,
          dockerPort: makeMockDockerPort(),
        } as unknown as ConstructorParameters<typeof CpuExperimentAdapter>[0]),
    ).toThrow('commitOutputs must be a function');
  });
  it('rejects unknown environment with environment_unavailable', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const events = await collectEvents(
      adapter.execute(makeRun({ environmentId: 'unknown-env' }), signal),
    );

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('environment_unavailable');
    }
    // No container may ever be started for an invalid environment.
    expect(port.runCalls).toHaveLength(0);
    expect(port.rmCalls).toHaveLength(0);
  });

  it('accepts valid environment and emits started', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    expect(started.events[0]?.type).toBe('started');
    port.process.close(0);
    await drain(started);
  });
});

describe('dependency validation', () => {
  it('rejects undeclared dependency without starting a container', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();
    const run = makeRun({
      dependencies: [{ name: 'numpy', version: '1.26.4' }],
    });

    const events = await collectEvents(adapter.execute(run, signal));
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('environment_unavailable');
    }
    expect(port.runCalls).toHaveLength(0);
    expect(port.rmCalls).toHaveLength(0);
  });

  it('rejects version-mismatched dependency', async () => {
    const adapter = makeAdapter();
    const { signal } = makeAbortSignal();
    const run = makeRun({
      dependencies: [{ name: 'python', version: '3.12.0' }],
    });

    const events = await collectEvents(adapter.execute(run, signal));
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
  });
});
