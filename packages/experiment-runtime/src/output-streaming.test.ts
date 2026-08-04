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

function makeAdapter(port: MockDockerPort): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: defaultCodeResolver(),
    resolveInput: defaultInputResolver(),
    commitOutputs: async () => ({ artifacts: [], logs: [] }),
    dockerPort: port,
  });
}

function makeSmallQuotaRun(maxStdoutBytes: number, maxLogBytes: number) {
  return makeRun({
    resourceBudget: {
      ...makeRun().resourceBudget,
      maxStdoutBytes,
      maxLogBytes,
    },
  });
}

describe('output streaming', () => {
  it('pushes stdout and stderr events to the queue', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.emitStdout('hello\n');
    port.process.emitStderr('oops\n');
    port.process.close(0);
    const events = await drain(started);

    const output = events.filter((e) => e.type === 'output');
    const stdout = output.find(
      (e) => e.type === 'output' && e.kind === 'stdout',
    );
    const stderr = output.find(
      (e) => e.type === 'output' && e.kind === 'stderr',
    );
    expect(stdout?.type === 'output' ? stdout.content : null).toBe('hello\n');
    expect(stderr?.type === 'output' ? stderr.content : null).toBe('oops\n');
  });

  it('splits oversized stdout into multiple bounded events (no truncation)', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const big = 'x'.repeat(200_000);
    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.emitStdout(big);
    port.process.close(0);
    const events = await drain(started);

    const stdoutEvents = events.filter(
      (e): e is { type: 'output'; kind: 'stdout'; content: string } =>
        e.type === 'output' && e.kind === 'stdout',
    );

    expect(stdoutEvents.length).toBeGreaterThan(1);
    for (const event of stdoutEvents) {
      expect(event.content.length).toBeLessThanOrEqual(65536);
    }
    const joined = stdoutEvents.map((e) => e.content).join('');
    expect(joined).toBe(big);
  });

  it('emits at most maxStdoutBytes of streamed stdout before quota', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();
    const run = makeSmallQuotaRun(32, 32);

    const started = await startRun(adapter.execute(run, signal));
    port.process.emitStdout('x'.repeat(20));
    port.process.emitStdout('y'.repeat(20));
    port.process.close(0);
    const events = await drain(started);

    const stdoutEvents = events.filter(
      (e) => e.type === 'output' && e.kind === 'stdout',
    );
    const streamed = stdoutEvents
      .map((e) => (e.type === 'output' ? e.content : ''))
      .join('');
    // Only the first data chunk (20 bytes) fits; the second pushes past the
    // quota and is dropped.
    expect(streamed).toBe('x'.repeat(20));
  });
});

describe('quota cleanup (immediate docker rm -f)', () => {
  it('calls docker rm -f immediately on stdout quota even if the process never closes', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: defaultCodeResolver(),
      resolveInput: defaultInputResolver(),
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });
    const { signal } = makeAbortSignal();
    const run = makeSmallQuotaRun(8, 8);

    const started = await startRun(adapter.execute(run, signal));
    // Never call close(): the runner must not wait for the process to exit.
    port.process.emitStdout('z'.repeat(10_000));
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('resource_quota_exceeded');
    }
    expect(port.rmCalls).toContain('exp-run-001');
  });

  it('calls docker rm -f immediately on stderr quota even if the process never closes', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: defaultCodeResolver(),
      resolveInput: defaultInputResolver(),
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });
    const { signal } = makeAbortSignal();
    const run = makeSmallQuotaRun(8, 8);

    const started = await startRun(adapter.execute(run, signal));
    port.process.emitStderr('e'.repeat(10_000));
    const events = await drain(started);

    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('resource_quota_exceeded');
    }
    expect(port.rmCalls).toContain('exp-run-001');
  });
});

describe('event content safety', () => {
  it('events do not contain host paths or storage keys', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    const { signal } = makeAbortSignal();

    const started = await startRun(adapter.execute(makeRun(), signal));
    port.process.close(0);
    const events = await drain(started);

    const eventStr = JSON.stringify(events);
    expect(eventStr).not.toContain('/Users/tim');
    expect(eventStr).not.toContain('objectKey');
    expect(eventStr).not.toContain('storageRoot');
  });

  it('failed events expose a stable failureCode and nothing else', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => {
        throw new Error('internal error with secrets and stack');
      },
      resolveInput: defaultInputResolver(),
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });
    const { signal } = makeAbortSignal();

    const events: import('@educanvas/agent-core').ExperimentRunEvent[] = [];
    for await (const event of adapter.execute(makeRun(), signal)) {
      events.push(event);
    }
    const terminal = getTerminalEvent(events);

    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      const str = JSON.stringify(terminal);
      expect(str).not.toContain('stack');
      expect(str).not.toContain('internal error');
      expect(str).not.toContain('process.env');
      expect(str).not.toContain('SECRET');
      // Resolver failures map to the stable input_unavailable code only.
      expect(str).toContain('"input_unavailable"');
    }
  });
});
