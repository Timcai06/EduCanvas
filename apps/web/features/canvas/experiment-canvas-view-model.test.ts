import { describe, expect, it } from 'vitest';
import {
  EXPERIMENT_CANVAS_MAX_CODE_CHARS,
  EXPERIMENT_CANVAS_MAX_TABLE_ROWS,
  EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS,
  parseExperimentCanvasViewModel,
  selectVisibleExperimentLogs,
  truncateExperimentText,
} from './experiment-canvas-view-model';

const budget = {
  maxDurationMs: 10_000,
  maxMemoryMiB: 256,
  maxProcesses: 16,
  maxStdoutBytes: 32_768,
  maxLogBytes: 65_536,
  maxOutputBytes: 1_048_576,
  maxOutputFiles: 8,
};

const output = {
  artifactId: 'artifact-output-1',
  artifactVersionId: 'artifact-version-1',
  kind: 'table',
  mimeType: 'text/csv',
  checksum: 'b'.repeat(64),
  byteSize: 128,
};

const common = {
  title: '线性回归实验',
  runId: 'run-1',
  code: {
    language: 'python' as const,
    content: 'print("hello")',
    codeVersionId: 'code-version-1',
    codeHash: 'a'.repeat(64),
  },
  environmentId: 'cpu-python-3.11',
  inputs: [
    {
      mountName: 'dataset.csv',
      artifactId: 'artifact-input-1',
      artifactVersionId: 'artifact-input-version-1',
      mimeType: 'text/csv',
      checksum: 'c'.repeat(64),
      byteSize: 64,
      label: '训练数据',
    },
  ],
  dependencies: [{ name: 'python', version: '3.11.15' }],
  randomSeed: 42,
  resourceBudget: budget,
};

function makeProvenance(status: 'succeeded' | 'failed' | 'cancelled') {
  return {
    runId: common.runId,
    codeVersionId: common.code.codeVersionId,
    codeHash: common.code.codeHash,
    environmentId: common.environmentId,
    dependencies: common.dependencies,
    inputs: common.inputs.map((input) => ({
      mountName: input.mountName,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      checksum: input.checksum,
    })),
    randomSeed: common.randomSeed,
    resourceBudget: budget,
    startedAt: '2026-08-04T00:00:00.000Z',
    finishedAt: '2026-08-04T00:00:01.000Z',
    terminalStatus: status,
    failureCode: status === 'failed' ? ('execution_failed' as const) : null,
    outputs: status === 'succeeded' ? [output] : [],
  };
}

function makeTerminal(status: 'succeeded' | 'failed' | 'cancelled') {
  const outputs = status === 'succeeded' ? [output] : [];
  return {
    ...common,
    status,
    result: {
      runId: common.runId,
      status,
      failureCode: status === 'failed' ? ('execution_failed' as const) : null,
      outputs,
      logs: [{ kind: 'text' as const, content: 'bounded log' }],
    },
    provenance: makeProvenance(status),
    outputViews:
      status === 'succeeded'
        ? [
            {
              ...output,
              label: '结果表格',
              preview: {
                kind: 'table' as const,
                caption: '模型指标',
                columns: ['metric', 'value'],
                rows: [['accuracy', '0.95']],
              },
            },
          ]
        : [],
  };
}

describe('experiment canvas view model', () => {
  it('accepts every honest lifecycle state', () => {
    const values = [
      {
        status: 'unavailable',
        title: '实验不可用',
        reason: 'experiment_not_available',
      },
      { ...common, status: 'queued', logs: [] },
      { ...common, status: 'running', logs: [] },
      makeTerminal('succeeded'),
      makeTerminal('failed'),
      makeTerminal('cancelled'),
    ];

    for (const value of values) {
      expect(parseExperimentCanvasViewModel(value).kind).toBe('available');
    }
  });

  it('rejects mismatched terminal status, code and output evidence', () => {
    const statusMismatch = {
      ...makeTerminal('succeeded'),
      status: 'failed',
    };
    const codeMismatch = {
      ...makeTerminal('succeeded'),
      code: { ...common.code, codeHash: 'd'.repeat(64) },
    };
    const outputMismatch = {
      ...makeTerminal('succeeded'),
      outputViews: [
        {
          ...makeTerminal('succeeded').outputViews[0],
          checksum: 'e'.repeat(64),
        },
      ],
    };
    const configurationMismatch = {
      ...makeTerminal('succeeded'),
      randomSeed: 99,
    };

    expect(parseExperimentCanvasViewModel(statusMismatch).kind).toBe(
      'unavailable',
    );
    expect(parseExperimentCanvasViewModel(codeMismatch).kind).toBe(
      'unavailable',
    );
    expect(parseExperimentCanvasViewModel(outputMismatch).kind).toBe(
      'unavailable',
    );
    expect(parseExperimentCanvasViewModel(configurationMismatch).kind).toBe(
      'unavailable',
    );
  });

  it('rejects private or unbounded fields instead of projecting them', () => {
    const sensitive = {
      ...makeTerminal('succeeded'),
      objectKey: 'private/object-key',
    };
    const oversizedCode = {
      ...common,
      status: 'running',
      logs: [],
      code: {
        ...common.code,
        content: 'x'.repeat(EXPERIMENT_CANVAS_MAX_CODE_CHARS + 1),
      },
    };
    const tooManyRows = makeTerminal('succeeded');
    tooManyRows.outputViews[0]!.preview = {
      kind: 'table',
      caption: 'too large',
      columns: ['value'],
      rows: Array.from({ length: EXPERIMENT_CANVAS_MAX_TABLE_ROWS + 1 }, () => [
        'x',
      ]),
    };

    expect(parseExperimentCanvasViewModel(sensitive).kind).toBe('unavailable');
    expect(parseExperimentCanvasViewModel(oversizedCode).kind).toBe(
      'unavailable',
    );
    expect(parseExperimentCanvasViewModel(tooManyRows).kind).toBe(
      'unavailable',
    );
  });

  it('truncates by Unicode code point without splitting a surrogate pair', () => {
    expect(truncateExperimentText('A🧪B', 2)).toEqual({
      text: 'A🧪',
      truncated: true,
    });
  });

  it('bounds visible logs while leaving the source array unchanged', () => {
    const content = 'x'.repeat(EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS + 100);
    const source = [{ kind: 'text' as const, content }];
    const visible = selectVisibleExperimentLogs(source);

    expect(visible.truncated).toBe(true);
    expect(visible.entries[0]).toEqual({
      kind: 'text',
      content: 'x'.repeat(EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS),
    });
    expect(source[0]!.content).toHaveLength(
      EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS + 100,
    );
  });
});
