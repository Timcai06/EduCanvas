import { describe, expect, it } from 'vitest';
import {
  experimentOutputArtifactSchema,
  experimentProvenanceSchema,
  experimentRunEventSchema,
  experimentRunResultSchema,
  MAX_EXPERIMENT_LOG_BYTES,
  rejectsCustomImageOrShell,
  rejectsGpuCapability,
  rejectsNetworkCapability,
} from './experiment-runtime-port';

/* ── helpers ──────────────────────────────────────────────────────────────── */

const SHA256 = 'a'.repeat(64);
const VALID_DEP = { name: 'numpy', version: '1.26.4' };
const VALID_BUDGET = {
  maxDurationMs: 60_000,
  maxMemoryMiB: 512,
  maxProcesses: 4,
  maxStdoutBytes: 1024 * 1024,
  maxLogBytes: 2 * 1024 * 1024,
  maxOutputBytes: 10 * 1024 * 1024,
  maxOutputFiles: 16,
};
const VALID_OUTPUT = {
  artifactId: 'art-out-1',
  artifactVersionId: 'ver-out-1',
  kind: 'data',
  mimeType: 'text/csv',
  checksum: SHA256,
  byteSize: 2048,
};
const NOW = '2026-07-30T12:00:00.000Z';

function makeProvenance(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    codeVersionId: 'code-v1',
    codeHash: SHA256,
    environmentId: 'cpu-py3.11',
    dependencies: [VALID_DEP],
    inputs: [
      {
        mountName: 'data',
        artifactId: 'art-1',
        artifactVersionId: 'ver-1',
        checksum: SHA256,
      },
    ],
    randomSeed: 42,
    resourceBudget: VALID_BUDGET,
    startedAt: NOW,
    finishedAt: NOW,
    terminalStatus: 'succeeded',
    failureCode: null,
    outputs: [VALID_OUTPUT],
    ...overrides,
  };
}

function makeSucceededResult(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    status: 'succeeded',
    failureCode: null,
    outputs: [VALID_OUTPUT],
    logs: [],
    ...overrides,
  };
}

/* ── Tests ────────────────────────────────────────────────────────────────── */

describe('Output references (U13-E)', () => {
  it('accepts valid bounded Artifact Version reference', () => {
    expect(experimentOutputArtifactSchema.safeParse(VALID_OUTPUT).success).toBe(
      true,
    );
  });

  it('rejects objectKey field', () => {
    const input = { ...VALID_OUTPUT, objectKey: 's3://bucket/key' };
    expect(experimentOutputArtifactSchema.safeParse(input).success).toBe(false);
  });

  it('rejects hostPath field', () => {
    const input = { ...VALID_OUTPUT, hostPath: '/tmp/output.csv' };
    expect(experimentOutputArtifactSchema.safeParse(input).success).toBe(false);
  });

  it('rejects rawBytes field', () => {
    const input = { ...VALID_OUTPUT, rawBytes: 'base64...' };
    expect(experimentOutputArtifactSchema.safeParse(input).success).toBe(false);
  });

  it('rejects stack field', () => {
    const input = { ...VALID_OUTPUT, stack: 'Error at ...' };
    expect(experimentOutputArtifactSchema.safeParse(input).success).toBe(false);
  });

  it('rejects secret field', () => {
    const input = { ...VALID_OUTPUT, secret: 'key123' };
    expect(experimentOutputArtifactSchema.safeParse(input).success).toBe(false);
  });

  it('success result allows outputs', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: null,
        outputs: [VALID_OUTPUT],
        logs: [],
      }).success,
    ).toBe(true);
  });

  it('failed result rejects outputs', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'failed',
        failureCode: 'execution_failed',
        outputs: [VALID_OUTPUT],
        logs: [],
      }).success,
    ).toBe(false);
  });

  it('cancelled result rejects outputs', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'cancelled',
        failureCode: null,
        outputs: [VALID_OUTPUT],
        logs: [],
      }).success,
    ).toBe(false);
  });

  it('succeeded result requires null failureCode', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: 'execution_failed',
        outputs: [],
        logs: [],
      }).success,
    ).toBe(false);
  });

  it('failed result requires non-null failureCode', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'failed',
        failureCode: null,
        outputs: [],
        logs: [],
      }).success,
    ).toBe(false);
  });

  it.each(['queued', 'running'])('rejects non-terminal %s result', (status) => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status,
        failureCode: null,
        outputs: [],
        logs: [],
      }).success,
    ).toBe(false);
  });
});

describe('Log entries (U13-E)', () => {
  it('accepts bounded text log', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: null,
        outputs: [],
        logs: [{ kind: 'text', content: 'hello' }],
      }).success,
    ).toBe(true);
  });

  it('accepts artifact reference log', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: null,
        outputs: [],
        logs: [
          {
            kind: 'artifact_ref',
            artifactId: 'art-1',
            artifactVersionId: 'ver-1',
            mimeType: 'text/plain',
            checksum: SHA256,
            byteSize: 4096,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects raw log bytes', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: null,
        outputs: [],
        logs: [{ kind: 'raw', content: Buffer.from('data') }],
      }).success,
    ).toBe(false);
  });

  it('rejects objectKey in log', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: null,
        outputs: [],
        logs: [{ kind: 'artifact_ref', objectKey: 's3://key' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an Artifact reference larger than the platform log limit', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'succeeded',
        failureCode: null,
        outputs: [],
        logs: [
          {
            kind: 'artifact_ref',
            artifactId: 'art-1',
            artifactVersionId: 'ver-1',
            mimeType: 'text/plain',
            checksum: SHA256,
            byteSize: MAX_EXPERIMENT_LOG_BYTES + 1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('Provenance (U13-F)', () => {
  it('accepts complete provenance record', () => {
    expect(experimentProvenanceSchema.safeParse(makeProvenance()).success).toBe(
      true,
    );
  });

  it('rejects unknown fields (strict)', () => {
    expect(
      experimentProvenanceSchema.safeParse({
        ...makeProvenance({ outputs: [] }),
        hostPath: '/tmp/sandbox',
      }).success,
    ).toBe(false);
  });

  it('rejects objectKey in provenance', () => {
    expect(
      experimentProvenanceSchema.safeParse({
        ...makeProvenance({ outputs: [] }),
        objectKey: 's3://bucket',
      }).success,
    ).toBe(false);
  });

  it('rejects secret in provenance', () => {
    expect(
      experimentProvenanceSchema.safeParse({
        ...makeProvenance({ outputs: [] }),
        secret: 'api-key',
      }).success,
    ).toBe(false);
  });

  it.each([
    ['queued', NOW],
    ['running', NOW],
    ['succeeded', null],
  ])(
    'rejects non-terminal or unfinished provenance',
    (terminalStatus, finishedAt) => {
      expect(
        experimentProvenanceSchema.safeParse(
          makeProvenance({ terminalStatus, finishedAt }),
        ).success,
      ).toBe(false);
    },
  );

  it('rejects failure-code and output combinations that contradict terminal state', () => {
    expect(
      experimentProvenanceSchema.safeParse(
        makeProvenance({ failureCode: 'execution_failed' }),
      ).success,
    ).toBe(false);
    expect(
      experimentProvenanceSchema.safeParse(
        makeProvenance({
          terminalStatus: 'failed',
          failureCode: 'execution_failed',
        }),
      ).success,
    ).toBe(false);
  });
});

describe('ExperimentRunEvent (streaming protocol)', () => {
  it('accepts started event', () => {
    expect(
      experimentRunEventSchema.safeParse({ type: 'started' }).success,
    ).toBe(true);
  });

  it('accepts stdout output event', () => {
    expect(
      experimentRunEventSchema.safeParse({
        type: 'output',
        kind: 'stdout',
        content: 'hello world',
      }).success,
    ).toBe(true);
  });

  it('accepts a terminal event with final result and provenance', () => {
    expect(
      experimentRunEventSchema.safeParse({
        type: 'succeeded',
        result: makeSucceededResult(),
        provenance: makeProvenance(),
      }).success,
    ).toBe(true);
  });

  it('rejects unknown event type', () => {
    expect(
      experimentRunEventSchema.safeParse({ type: 'unknown' }).success,
    ).toBe(false);
  });

  it('rejects missing failureCode on failed', () => {
    expect(experimentRunEventSchema.safeParse({ type: 'failed' }).success).toBe(
      false,
    );
  });

  it('rejects terminal evidence for another run or status', () => {
    expect(
      experimentRunEventSchema.safeParse({
        type: 'succeeded',
        result: makeSucceededResult(),
        provenance: makeProvenance({ runId: 'other-run' }),
      }).success,
    ).toBe(false);
    expect(
      experimentRunEventSchema.safeParse({
        type: 'succeeded',
        result: makeSucceededResult(),
        provenance: makeProvenance({ terminalStatus: 'failed' }),
      }).success,
    ).toBe(false);
  });
});

describe('Rejection predicates', () => {
  it('rejectsNetworkCapability detects network=true', () => {
    expect(rejectsNetworkCapability({ network: true })).toBe(true);
    expect(rejectsNetworkCapability({ enableNetwork: true })).toBe(true);
    expect(rejectsNetworkCapability({ capabilities: { network: true } })).toBe(
      true,
    );
    expect(rejectsNetworkCapability({ network: false })).toBe(false);
    expect(rejectsNetworkCapability(null)).toBe(false);
  });

  it('rejectsGpuCapability detects gpu=true', () => {
    expect(rejectsGpuCapability({ gpu: true })).toBe(true);
    expect(rejectsGpuCapability({ enableGpu: true })).toBe(true);
    expect(rejectsGpuCapability({ capabilities: { gpu: true } })).toBe(true);
    expect(rejectsGpuCapability({ gpu: false })).toBe(false);
  });

  it('rejectsCustomImageOrShell detects image/shell/command', () => {
    expect(rejectsCustomImageOrShell({ image: 'python:3' })).toBe(true);
    expect(rejectsCustomImageOrShell({ dockerImage: 'node:22' })).toBe(true);
    expect(rejectsCustomImageOrShell({ shell: '/bin/bash' })).toBe(true);
    expect(rejectsCustomImageOrShell({ command: 'npm test' })).toBe(true);
    expect(rejectsCustomImageOrShell({})).toBe(false);
  });
});
