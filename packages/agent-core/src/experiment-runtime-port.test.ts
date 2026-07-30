import { describe, expect, it } from 'vitest';
import {
  canTransitionExperimentRunStatus,
  experimentFailureCodes,
  experimentRunResultSchema,
  experimentRunSchema,
  experimentRunStatusSchema,
  experimentRunStatuses,
  experimentResourceBudgetSchema,
  MAX_EXPERIMENT_DURATION_MS,
  MAX_EXPERIMENT_LOG_BYTES,
  MAX_EXPERIMENT_MEMORY_MIB,
  MAX_EXPERIMENT_OUTPUT_BYTES,
  MAX_EXPERIMENT_OUTPUT_FILES,
  MAX_EXPERIMENT_PROCESSES,
  MAX_EXPERIMENT_STDOUT_BYTES,
  type ExperimentRun,
} from './experiment-runtime-port';

/* ── helpers ──────────────────────────────────────────────────────────────── */

const SHA256 = 'a'.repeat(64);
const VALID_MOUNT = {
  mountName: 'data',
  artifactId: 'art-1',
  artifactVersionId: 'ver-1',
  mimeType: 'text/csv',
  checksum: SHA256,
  byteSize: 1024,
};
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

function makeValidRun(overrides?: Partial<ExperimentRun>): ExperimentRun {
  return {
    runId: 'run-1',
    notebookId: 'nb-1',
    codeVersionId: 'code-v1',
    codeHash: SHA256,
    environmentId: 'cpu-py3.11',
    inputs: [VALID_MOUNT],
    dependencies: [VALID_DEP],
    randomSeed: 42,
    resourceBudget: VALID_BUDGET,
    ...overrides,
  };
}

/* ── Tests ────────────────────────────────────────────────────────────────── */

describe('ExperimentRun schema (U13-B)', () => {
  it('accepts a valid CPU-only, no-network, fixed-environment Run', () => {
    const result = experimentRunSchema.safeParse(makeValidRun());
    expect(result.success).toBe(true);
  });

  it('rejects network=true via capabilities', () => {
    const input = { ...makeValidRun(), capabilities: { network: true } };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects network via top-level field', () => {
    const input = { ...makeValidRun(), network: true };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects GPU', () => {
    const input = { ...makeValidRun(), gpu: true };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects custom image', () => {
    const input = { ...makeValidRun(), image: 'python:3.11' };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects shell command', () => {
    const input = { ...makeValidRun(), shell: '/bin/bash' };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects absolute path in mountName', () => {
    const input = {
      ...makeValidRun(),
      inputs: [{ ...VALID_MOUNT, mountName: '/etc/data' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects .. path traversal in mountName', () => {
    const input = {
      ...makeValidRun(),
      inputs: [{ ...VALID_MOUNT, mountName: '../etc/passwd' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty mountName', () => {
    const input = {
      ...makeValidRun(),
      inputs: [{ ...VALID_MOUNT, mountName: '' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects dependency version range', () => {
    const input = {
      ...makeValidRun(),
      dependencies: [{ name: 'numpy', version: '>=1.20' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects dependency version latest', () => {
    const input = {
      ...makeValidRun(),
      dependencies: [{ name: 'numpy', version: 'latest' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects dependency URL', () => {
    const input = {
      ...makeValidRun(),
      dependencies: [{ name: 'numpy', version: 'https://example.com/pkg' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects git URL dependency', () => {
    const input = {
      ...makeValidRun(),
      dependencies: [{ name: 'numpy', version: 'git+https://github.com' }],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects duplicate dependencies', () => {
    const input = {
      ...makeValidRun(),
      dependencies: [
        { name: 'numpy', version: '1.26.4' },
        { name: 'numpy', version: '1.26.4' },
      ],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects duplicate mount names', () => {
    const input = {
      ...makeValidRun(),
      inputs: [
        { ...VALID_MOUNT, mountName: 'data' },
        { ...VALID_MOUNT, mountName: 'data' },
      ],
    };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    const input = { ...makeValidRun(), unknownField: 'hello' };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty inputs array', () => {
    const input = { ...makeValidRun(), inputs: [] };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty dependencies array', () => {
    const input = { ...makeValidRun(), dependencies: [] };
    expect(experimentRunSchema.safeParse(input).success).toBe(false);
  });
});

describe('Resource budget (U13-C)', () => {
  it('rejects zero maxDurationMs', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxDurationMs: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects negative maxDurationMs', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxDurationMs: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects maxDurationMs exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxDurationMs: MAX_EXPERIMENT_DURATION_MS + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects zero maxMemoryMiB', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxMemoryMiB: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects maxMemoryMiB exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxMemoryMiB: MAX_EXPERIMENT_MEMORY_MIB + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects zero maxProcesses', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxProcesses: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects maxProcesses exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxProcesses: MAX_EXPERIMENT_PROCESSES + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects maxStdoutBytes exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxStdoutBytes: MAX_EXPERIMENT_STDOUT_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects maxLogBytes exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxLogBytes: MAX_EXPERIMENT_LOG_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects maxOutputBytes exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxOutputBytes: MAX_EXPERIMENT_OUTPUT_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects maxOutputFiles exceeding platform limit', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        maxOutputFiles: MAX_EXPERIMENT_OUTPUT_FILES + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    expect(
      experimentResourceBudgetSchema.safeParse({
        ...VALID_BUDGET,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe('State machine (U13-D)', () => {
  it('defines exactly 5 statuses', () => {
    expect(experimentRunStatuses).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
    ]);
  });

  it('queued → running is valid', () => {
    expect(canTransitionExperimentRunStatus('queued', 'running')).toBe(true);
  });

  it('queued → cancelled is valid', () => {
    expect(canTransitionExperimentRunStatus('queued', 'cancelled')).toBe(true);
  });

  it('queued → succeeded is invalid', () => {
    expect(canTransitionExperimentRunStatus('queued', 'succeeded')).toBe(false);
  });

  it('queued → failed is invalid', () => {
    expect(canTransitionExperimentRunStatus('queued', 'failed')).toBe(false);
  });

  it('running → succeeded is valid', () => {
    expect(canTransitionExperimentRunStatus('running', 'succeeded')).toBe(true);
  });

  it('running → failed is valid', () => {
    expect(canTransitionExperimentRunStatus('running', 'failed')).toBe(true);
  });

  it('running → cancelled is valid', () => {
    expect(canTransitionExperimentRunStatus('running', 'cancelled')).toBe(true);
  });

  it('running → queued is invalid', () => {
    expect(canTransitionExperimentRunStatus('running', 'queued')).toBe(false);
  });

  it('succeeded has no outgoing transitions', () => {
    for (const status of experimentRunStatuses) {
      expect(canTransitionExperimentRunStatus('succeeded', status)).toBe(false);
    }
  });

  it('failed has no outgoing transitions', () => {
    for (const status of experimentRunStatuses) {
      expect(canTransitionExperimentRunStatus('failed', status)).toBe(false);
    }
  });

  it('cancelled has no outgoing transitions', () => {
    for (const status of experimentRunStatuses) {
      expect(canTransitionExperimentRunStatus('cancelled', status)).toBe(false);
    }
  });

  it('unknown status not in closed set', () => {
    expect(experimentRunStatusSchema.safeParse('unknown').success).toBe(false);
  });

  it('failed status cannot be disguised as succeeded in schema', () => {
    const ok = experimentRunResultSchema.safeParse({
      runId: 'r1',
      status: 'failed',
      failureCode: 'execution_failed',
      outputs: [],
      logs: [],
    });
    expect(ok.success).toBe(true);
    const bad = experimentRunResultSchema.safeParse({
      runId: 'r1',
      status: 'succeeded',
      failureCode: 'execution_failed',
      outputs: [],
      logs: [],
    });
    expect(bad.success).toBe(false);
  });
});

describe('Failure codes (U13-D)', () => {
  it('covers all required codes', () => {
    const required = [
      'experiment_timeout',
      'experiment_cancelled',
      'resource_quota_exceeded',
      'input_unavailable',
      'environment_unavailable',
      'execution_failed',
      'output_validation_failed',
    ];
    expect(experimentFailureCodes).toEqual(expect.arrayContaining(required));
  });

  it('rejects unknown failure code', () => {
    expect(
      experimentRunResultSchema.safeParse({
        runId: 'r1',
        status: 'failed',
        failureCode: 'unknown_code',
        outputs: [],
        logs: [],
      }).success,
    ).toBe(false);
  });
});
