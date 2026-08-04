import { describe, expect, it } from 'vitest';
import { CpuExperimentAdapter } from './cpu-experiment-adapter';
import {
  makeRun,
  makeCodeBytes,
  makeInputBytes,
  makeAbortSignal,
  makeMockDockerPort,
  defaultInputResolver,
  collectEvents,
  getTerminalEvent,
  type MockDockerPort,
} from './test-helpers';
import { sha256hex } from './run-materializer';

function makeAdapter(port: MockDockerPort): CpuExperimentAdapter {
  return new CpuExperimentAdapter({
    resolveCode: async () => ({
      bytes: makeCodeBytes(),
      checksum: sha256hex(makeCodeBytes()),
    }),
    resolveInput: defaultInputResolver(),
    commitOutputs: async () => ({ artifacts: [], logs: [] }),
    dockerPort: port,
  });
}

describe('code materialization', () => {
  it('fails with input_unavailable when codeHash does not match bytes', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: makeCodeBytes('wrong code'),
        checksum: sha256hex(makeCodeBytes('wrong code')),
      }),
      resolveInput: defaultInputResolver(),
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });

    const { signal } = makeAbortSignal();
    const events = await collectEvents(adapter.execute(makeRun(), signal));
    const terminal = getTerminalEvent(events);

    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('input_unavailable');
    }
    // Materialization must fail before any container starts.
    expect(port.runCalls).toHaveLength(0);
  });

  it('fails with input_unavailable when the code resolver rejects', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => {
        throw new Error('code version gone');
      },
      resolveInput: defaultInputResolver(),
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });

    const { signal } = makeAbortSignal();
    const events = await collectEvents(adapter.execute(makeRun(), signal));
    const terminal = getTerminalEvent(events);

    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('input_unavailable');
    }
    expect(port.runCalls).toHaveLength(0);
  });
});

describe('input materialization', () => {
  it('fails with input_unavailable when the input checksum does not match', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: makeCodeBytes(),
        checksum: sha256hex(makeCodeBytes()),
      }),
      resolveInput: async () => {
        const bytes = makeInputBytes('different data');
        return {
          bytes,
          checksum: sha256hex(bytes),
          byteSize: bytes.byteLength,
        };
      },
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });

    const { signal } = makeAbortSignal();
    const run = makeRun({
      inputs: [
        {
          mountName: 'data',
          artifactId: 'art-001',
          artifactVersionId: 'art-v1',
          mimeType: 'text/csv',
          checksum: 'c'.repeat(64),
          byteSize: 100,
        },
      ],
    });

    const events = await collectEvents(adapter.execute(run, signal));
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('input_unavailable');
    }
    expect(port.runCalls).toHaveLength(0);
  });

  it('fails with input_unavailable when the input resolver rejects', async () => {
    const port = makeMockDockerPort();
    const adapter = new CpuExperimentAdapter({
      resolveCode: async () => ({
        bytes: makeCodeBytes(),
        checksum: sha256hex(makeCodeBytes()),
      }),
      resolveInput: async () => {
        throw new Error('input artifact missing');
      },
      commitOutputs: async () => ({ artifacts: [], logs: [] }),
      dockerPort: port,
    });

    const { signal } = makeAbortSignal();
    const events = await collectEvents(adapter.execute(makeRun(), signal));
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('input_unavailable');
    }
    expect(port.runCalls).toHaveLength(0);
  });
});

describe('error mapping', () => {
  it('maps unexpected internal errors to execution_failed, not input_unavailable', async () => {
    const port = makeMockDockerPort();
    const adapter = makeAdapter(port);
    // Force an unexpected failure by making the runner reject: empty command
    // is rejected by runDockerContainer before spawning.
    port.dockerRun = () => {
      throw new Error('docker binary missing');
    };

    const { signal } = makeAbortSignal();
    const events = await collectEvents(adapter.execute(makeRun(), signal));
    const terminal = getTerminalEvent(events);
    expect(terminal?.type).toBe('failed');
    if (terminal?.type === 'failed') {
      expect(terminal.result.failureCode).toBe('execution_failed');
    }
  });
});
