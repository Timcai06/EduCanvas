import { describe, expect, it } from 'vitest';
import {
  runDockerContainer,
  splitIntoChunks,
  mapTerminationToFailureCode,
  isCleanRunResult,
  type RunResult,
} from './docker-process-runner';
import { createEventQueue } from './event-queue';
import {
  makeRun,
  makeMockDockerPort,
  type MockDockerPort,
} from './test-helpers';

const budget = makeRun().resourceBudget;

function makeOptions(port: MockDockerPort, signal: AbortSignal) {
  return {
    command: ['docker', 'run', '--name', 'exp-test', 'image'],
    budget,
    containerName: 'exp-test',
    dockerPort: port,
    signal,
    queue: createEventQueue(),
  };
}

describe('splitIntoChunks', () => {
  it('returns the whole text when it fits', () => {
    expect(splitIntoChunks('hello', 65536)).toEqual(['hello']);
  });

  it('splits oversized text into bounded chunks that rejoin exactly', () => {
    const big = 'a'.repeat(200_000);
    const chunks = splitIntoChunks(big, 65536);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf-8')).toBeLessThanOrEqual(65536);
    }
    expect(chunks.join('')).toBe(big);
  });

  it('handles multibyte content without exceeding the byte budget', () => {
    const text = 'é'.repeat(100_000);
    const chunks = splitIntoChunks(text, 1024);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf-8')).toBeLessThanOrEqual(1024);
    }
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('preserves multibyte UTF-8 characters across chunk boundaries', () => {
    const text = '你好🙂世界'.repeat(20_000);
    const chunks = splitIntoChunks(text, 65_536);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(65_536);
      expect(chunk).not.toContain('�');
    }
  });
});

describe('mapTerminationToFailureCode', () => {
  const cases: [Parameters<typeof mapTerminationToFailureCode>[0], string][] = [
    ['timeout', 'experiment_timeout'],
    ['user_cancel', 'experiment_cancelled'],
    ['stdout_quota', 'resource_quota_exceeded'],
    ['stderr_quota', 'resource_quota_exceeded'],
    ['process_exit', 'execution_failed'],
    ['spawn_error', 'execution_failed'],
  ];
  for (const [reason, code] of cases) {
    it(`maps ${reason} to ${code}`, () => {
      expect(mapTerminationToFailureCode(reason)).toBe(code);
    });
  }

  it('strictly maps timeout to experiment_timeout, never cancelled', () => {
    expect(mapTerminationToFailureCode('timeout')).toBe('experiment_timeout');
    expect(mapTerminationToFailureCode('timeout')).not.toBe(
      'experiment_cancelled',
    );
  });
});

describe('isCleanRunResult', () => {
  it('accepts only process_exit with exit code 0', () => {
    const clean: RunResult = {
      exitCode: 0,
      terminationReason: 'process_exit',
      quotaType: null,
    };
    const killed: RunResult = {
      exitCode: 0,
      terminationReason: 'timeout',
      quotaType: null,
    };
    expect(isCleanRunResult(clean)).toBe(true);
    expect(isCleanRunResult(killed)).toBe(false);
  });
});

describe('runDockerContainer', () => {
  it('returns spawn_error and removes the container when spawn throws', async () => {
    const port = makeMockDockerPort();
    port.dockerRun = () => {
      throw new Error('spawn failed');
    };
    const { signal } = new AbortController();

    const result = await runDockerContainer(makeOptions(port, signal));
    expect(result.terminationReason).toBe('spawn_error');
    expect(result.exitCode).toBe(1);
    expect(port.rmCalls).toContain('exp-test');
  });

  it('throws for an empty command', async () => {
    const port = makeMockDockerPort();
    const { signal } = new AbortController();
    await expect(
      runDockerContainer({ ...makeOptions(port, signal), command: [] }),
    ).rejects.toThrow('Docker command is empty');
  });

  it('immediately removes the container on stdout quota without waiting for close', async () => {
    const port = makeMockDockerPort();
    const { signal } = new AbortController();

    const resultPromise = runDockerContainer({
      ...makeOptions(port, signal),
      budget: { ...budget, maxStdoutBytes: 8, maxLogBytes: 8 },
    });

    port.process.emitStdout('y'.repeat(10_000));
    // No close() is ever called: the runner must resolve on its own.

    const result = await resultPromise;
    expect(result.terminationReason).toBe('stdout_quota');
    expect(result.quotaType).toBe('stdout');
    expect(port.rmCalls).toContain('exp-test');
  });

  it('immediately removes the container on stderr quota without waiting for close', async () => {
    const port = makeMockDockerPort();
    const { signal } = new AbortController();

    const resultPromise = runDockerContainer({
      ...makeOptions(port, signal),
      budget: { ...budget, maxStdoutBytes: 8, maxLogBytes: 8 },
    });

    port.process.emitStderr('w'.repeat(10_000));

    const result = await resultPromise;
    expect(result.terminationReason).toBe('stderr_quota');
    expect(result.quotaType).toBe('stderr');
    expect(port.rmCalls).toContain('exp-test');
  });

  it('reports process_exit for a normal exit', async () => {
    const port = makeMockDockerPort();
    const { signal } = new AbortController();

    const resultPromise = runDockerContainer(makeOptions(port, signal));
    port.process.close(0);

    const result = await resultPromise;
    expect(result.terminationReason).toBe('process_exit');
    expect(result.exitCode).toBe(0);
  });

  it('reports user_cancel and cleans up when the signal aborts', async () => {
    const port = makeMockDockerPort();
    const ctrl = new AbortController();

    const resultPromise = runDockerContainer(makeOptions(port, ctrl.signal));
    ctrl.abort();
    port.process.close(0);

    const result = await resultPromise;
    expect(result.terminationReason).toBe('user_cancel');
    expect(port.rmCalls).toContain('exp-test');
  });

  it('reports timeout and cleans up when the duration budget elapses', async () => {
    const port = makeMockDockerPort();
    const { signal } = new AbortController();

    const resultPromise = runDockerContainer({
      ...makeOptions(port, signal),
      budget: { ...budget, maxDurationMs: 20 },
    });
    // Process never closes: the runner's own timer must fire.
    const result = await resultPromise;
    expect(result.terminationReason).toBe('timeout');
    expect(port.rmCalls).toContain('exp-test');
  });

  it('does not remove the container on a clean exit', async () => {
    const port = makeMockDockerPort();
    const { signal } = new AbortController();

    const resultPromise = runDockerContainer(makeOptions(port, signal));
    port.process.close(0);

    const result = await resultPromise;
    expect(result.terminationReason).toBe('process_exit');
    expect(port.rmCalls).toHaveLength(0);
  });
});
