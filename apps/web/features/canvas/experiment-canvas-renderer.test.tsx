import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WEB_REGISTRY_ENTRIES } from './web-canvas-resource-registry-config';
import { ExperimentCanvasRenderer } from './experiment-canvas-renderer';
import {
  EXPERIMENT_CANVAS_VISIBLE_CODE_CHARS,
  EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS,
  EXPERIMENT_CANVAS_VISIBLE_TABLE_ROWS,
} from './experiment-canvas-view-model';

const budget = {
  maxDurationMs: 10_000,
  maxMemoryMiB: 256,
  maxProcesses: 16,
  maxStdoutBytes: 32_768,
  maxLogBytes: 262_144,
  maxOutputBytes: 1_048_576,
  maxOutputFiles: 8,
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

function makeProvenance(
  status: 'succeeded' | 'failed' | 'cancelled',
  outputs: readonly OutputReference[],
) {
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
    outputs,
  };
}

interface OutputReference {
  artifactId: string;
  artifactVersionId: string;
  kind: string;
  mimeType: string;
  checksum: string;
  byteSize: number;
}

function makeOutput(index: number, kind: 'table' | 'chart'): OutputReference {
  return {
    artifactId: `artifact-output-${index}`,
    artifactVersionId: `artifact-version-${index}`,
    kind,
    mimeType: kind === 'table' ? 'text/csv' : 'application/json',
    checksum: String(index).repeat(64),
    byteSize: 128,
  };
}

function makeTerminal(
  status: 'succeeded' | 'failed' | 'cancelled',
  outputViews: Record<string, unknown>[] = [],
  logs: Record<string, unknown>[] = [],
) {
  const outputs = outputViews.map((view) => ({
    artifactId: String(view.artifactId),
    artifactVersionId: String(view.artifactVersionId),
    kind: String(view.kind),
    mimeType: String(view.mimeType),
    checksum: String(view.checksum),
    byteSize: Number(view.byteSize),
  }));
  return {
    ...common,
    status,
    result: {
      runId: common.runId,
      status,
      failureCode: status === 'failed' ? ('execution_failed' as const) : null,
      outputs: status === 'succeeded' ? outputs : [],
      logs,
    },
    provenance: makeProvenance(status, status === 'succeeded' ? outputs : []),
    outputViews: status === 'succeeded' ? outputViews : [],
  };
}

function render(model: unknown, onOpenOutput = vi.fn()) {
  return renderToStaticMarkup(
    createElement(ExperimentCanvasRenderer, { model, onOpenOutput }),
  );
}

describe('ExperimentCanvasRenderer', () => {
  it.each([
    ['queued', '等待运行'],
    ['running', '正在运行'],
  ] as const)('renders accessible %s status', (status, copy) => {
    const html = render({ ...common, status, logs: [] });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(copy);
    expect(html).toContain('实验 Python 代码');
    expect(html).toContain('实验资源预算');
  });

  it.each([
    ['succeeded', '运行成功'],
    ['failed', '运行失败'],
    ['cancelled', '已取消'],
  ] as const)(
    'renders terminal %s with complete provenance',
    (status, copy) => {
      const html = render(makeTerminal(status));

      expect(html).toContain(copy);
      expect(html).toContain('完整复现信息');
      expect(html).toContain('实验完整 provenance');
      expect(html).toContain('code-version-1');
    },
  );

  it('renders only the stable failure code', () => {
    const html = render(makeTerminal('failed'));

    expect(html).toContain('execution_failed');
    expect(html).not.toContain('Error:');
    expect(html).not.toContain('stack');
  });

  it('renders bounded table and chart previews with controlled output buttons', () => {
    const tableOutput = {
      ...makeOutput(1, 'table'),
      label: '指标表格',
      preview: {
        kind: 'table',
        caption: '模型指标',
        columns: ['metric', 'value'],
        rows: Array.from(
          { length: EXPERIMENT_CANVAS_VISIBLE_TABLE_ROWS + 1 },
          (_, index) => [`metric-${index}`, String(index)],
        ),
      },
    };
    const chartOutput = {
      ...makeOutput(2, 'chart'),
      label: '损失曲线',
      preview: {
        kind: 'chart',
        chartType: 'line',
        title: '训练损失',
        xLabel: 'epoch',
        yLabel: 'loss',
        series: [
          {
            label: 'train',
            points: Array.from({ length: 51 }, (_, index) => ({
              x: index,
              y: 1 / (index + 1),
            })),
          },
        ],
      },
    };
    const onOpenOutput = vi.fn();
    const html = render(
      makeTerminal('succeeded', [tableOutput, chartOutput]),
      onOpenOutput,
    );

    expect(html).toContain('表格预览：模型指标');
    expect(html).toContain('表格已按展示上限截断');
    expect(html).toContain('图表序列：train');
    expect(html).toContain('图表数据已按展示上限截断');
    expect(html).toContain('aria-label="打开实验输出：指标表格"');
    expect(html).toContain('aria-label="打开实验输出：损失曲线"');
    expect(html).not.toContain('href=');
    expect(onOpenOutput).not.toHaveBeenCalled();
  });

  it('shows an honest empty-output success state', () => {
    expect(render(makeTerminal('succeeded'))).toContain(
      '运行成功，但没有输出文件',
    );
  });

  it('truncates long code and logs at the display boundary', () => {
    const html = render({
      ...common,
      status: 'running',
      code: {
        ...common.code,
        content: 'x'.repeat(EXPERIMENT_CANVAS_VISIBLE_CODE_CHARS + 1),
      },
      logs: Array.from(
        { length: EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS / 4096 + 1 },
        () => ({ kind: 'text', content: 'y'.repeat(4096) }),
      ),
    });

    expect(html).toContain('代码已按展示上限截断');
    expect(html).toContain('日志已按展示上限截断');
  });

  it('fails closed without reflecting private fields', () => {
    const html = render({
      ...makeTerminal('succeeded'),
      objectKey: 'private/object-key',
      stack: 'TOP_SECRET_STACK',
    });

    expect(html).toContain('实验详情不可用');
    expect(html).not.toContain('private/object-key');
    expect(html).not.toContain('TOP_SECRET_STACK');
  });

  it('maps unavailable reason codes to bounded product copy', () => {
    const html = render({
      status: 'unavailable',
      title: '实验暂不可用',
      reason: 'experiment_version_unavailable',
    });

    expect(html).toContain('实验暂不可用');
    expect(html).toContain('实验引用的版本已经不可用');
    expect(html).not.toContain('<button');
  });

  it('does not register a fake production renderer without a real data source', () => {
    expect(
      WEB_REGISTRY_ENTRIES.some(
        (entry) => entry.rendererId === 'artifact.experiment',
      ),
    ).toBe(false);
  });
});
