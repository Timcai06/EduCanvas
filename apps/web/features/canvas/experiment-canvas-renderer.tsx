'use client';

import type {
  ExperimentInputMount,
  ExperimentProvenance,
  ExperimentResourceBudget,
} from '@educanvas/agent-core';
import { CanvasShellStatus } from './canvas-shell-status';
import {
  ExperimentOutputPanel,
  formatExperimentBytes,
  type ExperimentOutputOpenHandler,
} from './experiment-canvas-output';
import {
  EXPERIMENT_CANVAS_VISIBLE_CODE_CHARS,
  getExperimentCanvasLogs,
  getExperimentFailureCode,
  parseExperimentCanvasViewModel,
  selectVisibleExperimentLogs,
  truncateExperimentText,
  type ExperimentCanvasViewModel,
} from './experiment-canvas-view-model';

export interface ExperimentCanvasRendererProps {
  /** Already projected browser-safe data. The component still validates it. */
  model: unknown;
  /** Host-controlled navigation; the renderer never constructs storage URLs. */
  onOpenOutput?: ExperimentOutputOpenHandler;
}

const STATUS_COPY = {
  queued: { label: '等待运行', tone: 'bg-surface-strong text-ink-muted' },
  running: { label: '正在运行', tone: 'bg-accent-soft text-accent' },
  succeeded: { label: '运行成功', tone: 'bg-surface-strong text-ink' },
  failed: { label: '运行失败', tone: 'bg-surface-strong text-danger' },
  cancelled: { label: '已取消', tone: 'bg-surface-strong text-ink-muted' },
} as const;

const UNAVAILABLE_COPY = {
  experiment_not_available: '当前环境无法提供这个实验。',
  experiment_details_unavailable: '实验详情暂时不可读取。',
  experiment_version_unavailable: '实验引用的版本已经不可用。',
} as const;

function CodePanel({ content }: { content: string }) {
  const visible = truncateExperimentText(
    content,
    EXPERIMENT_CANVAS_VISIBLE_CODE_CHARS,
  );
  return (
    <section aria-label="实验代码" className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">代码</h3>
      <pre
        tabIndex={0}
        aria-label="实验 Python 代码"
        className="max-h-80 overflow-auto rounded-xl border border-line bg-surface-strong p-4 font-mono text-xs leading-5 whitespace-pre text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <code>{visible.text}</code>
      </pre>
      {visible.truncated ? (
        <p className="text-xs text-ink-muted">代码已按展示上限截断。</p>
      ) : null}
    </section>
  );
}

function InputList({ inputs }: { inputs: readonly ExperimentInputMount[] }) {
  return (
    <section aria-label="实验输入引用" className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">输入引用</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {inputs.map((input) => (
          <li
            key={input.mountName}
            className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-xs"
          >
            <p className="truncate font-medium text-ink">
              {input.label ?? input.mountName}
            </p>
            <p className="mt-1 break-all text-ink-muted">
              {input.mimeType} · {formatExperimentBytes(input.byteSize)}
            </p>
            <p className="mt-1 break-all font-mono text-ink-muted">
              SHA-256 {input.checksum}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResourceBudgetTable({ budget }: { budget: ExperimentResourceBudget }) {
  const rows = [
    ['最长时间', `${budget.maxDurationMs} ms`],
    ['内存上限', `${budget.maxMemoryMiB} MiB`],
    ['进程上限', String(budget.maxProcesses)],
    ['标准输出', formatExperimentBytes(budget.maxStdoutBytes)],
    ['日志上限', formatExperimentBytes(budget.maxLogBytes)],
    ['输出总量', formatExperimentBytes(budget.maxOutputBytes)],
    ['输出文件', String(budget.maxOutputFiles)],
  ];
  return (
    <div
      role="region"
      aria-label="实验资源预算"
      tabIndex={0}
      className="overflow-x-auto overscroll-x-none rounded-xl border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <table className="w-full min-w-80 text-left text-xs">
        <caption className="sr-only">实验资源预算</caption>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-3 py-2 font-medium text-ink">
                {label}
              </th>
              <td className="px-3 py-2 text-ink-muted">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogPanel({
  model,
}: {
  model: Exclude<ExperimentCanvasViewModel, { status: 'unavailable' }>;
}) {
  const visible = selectVisibleExperimentLogs(getExperimentCanvasLogs(model));
  return (
    <section aria-label="实验有限日志" className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">有限日志</h3>
      {visible.entries.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无日志。</p>
      ) : (
        <ol className="space-y-2">
          {visible.entries.map((entry, index) => (
            <li key={`${entry.kind}-${index}`}>
              {entry.kind === 'text' ? (
                <pre
                  tabIndex={0}
                  aria-label={`实验日志 ${index + 1}`}
                  className="max-h-48 overflow-auto rounded-lg bg-surface-strong p-3 font-mono text-xs whitespace-pre-wrap text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {entry.content}
                </pre>
              ) : (
                <p className="break-all rounded-lg bg-surface-strong p-3 text-xs text-ink-muted">
                  日志 Artifact：{entry.mimeType} ·{' '}
                  {formatExperimentBytes(entry.byteSize)} · SHA-256{' '}
                  {entry.checksum}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {visible.truncated ? (
        <p className="text-xs font-medium text-ink-muted">
          日志已按展示上限截断。
        </p>
      ) : null}
    </section>
  );
}

function ProvenancePanel({ provenance }: { provenance: ExperimentProvenance }) {
  return (
    <details className="rounded-xl border border-line bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        完整复现信息
      </summary>
      <pre
        tabIndex={0}
        aria-label="实验完整 provenance"
        className="mt-3 max-h-80 overflow-auto text-xs whitespace-pre-wrap text-ink-muted"
      >
        {JSON.stringify(provenance, null, 2)}
      </pre>
    </details>
  );
}

function ExperimentExecutionView({
  model,
  onOpenOutput,
}: {
  model: Exclude<ExperimentCanvasViewModel, { status: 'unavailable' }>;
  onOpenOutput?: ExperimentCanvasRendererProps['onOpenOutput'];
}) {
  const status = STATUS_COPY[model.status];
  const failureCode = getExperimentFailureCode(model);
  const terminal =
    model.status === 'succeeded' ||
    model.status === 'failed' ||
    model.status === 'cancelled'
      ? model
      : null;

  return (
    <article
      aria-label={`实验 Canvas：${model.title}`}
      aria-busy={model.status === 'queued' || model.status === 'running'}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas px-4 py-5 text-ink sm:px-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
            CPU Experiment
          </p>
          <h2 className="mt-1 break-words text-lg font-semibold text-ink">
            {model.title}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-ink-muted">
            Run {model.runId}
          </p>
        </div>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`rounded-full px-3 py-1 text-xs font-medium ${status.tone}`}
        >
          {status.label}
        </span>
      </header>

      <div className="mt-5 grid min-w-0 gap-5">
        {failureCode ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-surface-strong p-3 text-sm text-danger"
          >
            稳定失败码：<code>{failureCode}</code>
          </p>
        ) : null}

        <CodePanel content={model.code.content} />
        <InputList inputs={model.inputs} />

        <section
          aria-label="实验固定配置"
          className="grid gap-3 lg:grid-cols-2"
        >
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">固定环境</h3>
            <dl className="rounded-xl border border-line bg-surface p-3 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">环境</dt>
                <dd className="break-all text-right font-mono text-ink">
                  {model.environmentId}
                </dd>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <dt className="text-ink-muted">随机种子</dt>
                <dd className="font-mono text-ink">{model.randomSeed}</dd>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <dt className="text-ink-muted">代码版本</dt>
                <dd className="break-all text-right font-mono text-ink">
                  {model.code.codeVersionId}
                </dd>
              </div>
            </dl>
            <ul
              aria-label="固定依赖"
              className="space-y-1 rounded-xl border border-line p-3 text-xs"
            >
              {model.dependencies.map((dependency) => (
                <li
                  key={dependency.name}
                  className="flex justify-between gap-4"
                >
                  <span className="break-all text-ink">{dependency.name}</span>
                  <code className="text-ink-muted">{dependency.version}</code>
                </li>
              ))}
            </ul>
          </div>
          <ResourceBudgetTable budget={model.resourceBudget} />
        </section>

        <LogPanel model={model} />
        {terminal?.status === 'succeeded' ? (
          <ExperimentOutputPanel
            outputs={terminal.outputViews}
            onOpenOutput={onOpenOutput}
          />
        ) : null}
        {terminal ? <ProvenancePanel provenance={terminal.provenance} /> : null}
      </div>
    </article>
  );
}

export function ExperimentCanvasRenderer({
  model,
  onOpenOutput,
}: ExperimentCanvasRendererProps) {
  const parsed = parseExperimentCanvasViewModel(model);
  if (parsed.kind === 'unavailable') {
    return (
      <CanvasShellStatus
        status="unavailable"
        title="实验详情不可用"
        description="实验数据未通过安全校验，无法在 Canvas 中展示。"
      />
    );
  }
  if (parsed.value.status === 'unavailable') {
    return (
      <CanvasShellStatus
        status="unavailable"
        title={parsed.value.title}
        description={UNAVAILABLE_COPY[parsed.value.reason]}
      />
    );
  }
  return (
    <ExperimentExecutionView model={parsed.value} onOpenOutput={onOpenOutput} />
  );
}
