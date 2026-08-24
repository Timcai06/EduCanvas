'use client';

import {
  EXPERIMENT_CANVAS_VISIBLE_CHART_POINTS,
  EXPERIMENT_CANVAS_VISIBLE_TABLE_ROWS,
  type ExperimentCanvasOutputView,
} from './experiment-canvas-view-model';

export type ExperimentOutputOpenHandler = (
  artifactId: string,
  artifactVersionId: string,
) => void;

export function formatExperimentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function TablePreview({
  preview,
}: {
  preview: Extract<
    NonNullable<ExperimentCanvasOutputView['preview']>,
    { kind: 'table' }
  >;
}) {
  const rows = preview.rows.slice(0, EXPERIMENT_CANVAS_VISIBLE_TABLE_ROWS);
  return (
    <div
      role="region"
      aria-label={`表格预览：${preview.caption}`}
      tabIndex={0}
      className="mt-3 overflow-x-auto overscroll-x-none rounded-lg border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <table className="w-full min-w-max text-left text-xs">
        <caption className="px-3 py-2 text-left font-medium text-ink">
          {preview.caption}
        </caption>
        <thead className="bg-surface-strong">
          <tr>
            {preview.columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                scope="col"
                className="px-3 py-2 font-medium text-ink"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-line">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="max-w-64 px-3 py-2 break-words text-ink-muted"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length < preview.rows.length ? (
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          表格已按展示上限截断。
        </p>
      ) : null}
    </div>
  );
}

function ChartPreview({
  preview,
}: {
  preview: Extract<
    NonNullable<ExperimentCanvasOutputView['preview']>,
    { kind: 'chart' }
  >;
}) {
  return (
    <figure className="mt-3 rounded-lg border border-line p-3">
      <figcaption className="text-sm font-medium text-ink">
        {preview.title} · {preview.chartType}
      </figcaption>
      <div className="mt-2 space-y-3">
        {preview.series.map((series, seriesIndex) => {
          const points = series.points.slice(
            0,
            EXPERIMENT_CANVAS_VISIBLE_CHART_POINTS,
          );
          return (
            <section
              key={`${series.label}-${seriesIndex}`}
              aria-label={`图表序列：${series.label}`}
            >
              <h4 className="text-xs font-medium text-ink">{series.label}</h4>
              <p className="mt-1 break-words font-mono text-xs text-ink-muted">
                {points.map((point) => `${point.x}: ${point.y}`).join(' · ')}
              </p>
              {points.length < series.points.length ? (
                <p className="mt-1 text-xs text-ink-muted">
                  图表数据已按展示上限截断。
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
      {preview.xLabel || preview.yLabel ? (
        <p className="mt-2 text-xs text-ink-muted">
          {preview.xLabel ? `横轴：${preview.xLabel}` : null}
          {preview.xLabel && preview.yLabel ? ' · ' : null}
          {preview.yLabel ? `纵轴：${preview.yLabel}` : null}
        </p>
      ) : null}
    </figure>
  );
}

export function ExperimentOutputPanel({
  outputs,
  onOpenOutput,
}: {
  outputs: readonly ExperimentCanvasOutputView[];
  onOpenOutput?: ExperimentOutputOpenHandler;
}) {
  return (
    <section aria-label="实验输出" className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">输出</h3>
      {outputs.length === 0 ? (
        <p className="text-sm text-ink-muted">运行成功，但没有输出文件。</p>
      ) : (
        <ul className="space-y-3">
          {outputs.map((output) => (
            <li
              key={output.artifactVersionId}
              className="rounded-xl border border-line p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {output.label}
                  </p>
                  <p className="break-all text-xs text-ink-muted">
                    {output.kind} · {output.mimeType} ·{' '}
                    {formatExperimentBytes(output.byteSize)}
                  </p>
                </div>
                {onOpenOutput ? (
                  <button
                    type="button"
                    aria-label={`打开实验输出：${output.label}`}
                    onClick={() =>
                      onOpenOutput(output.artifactId, output.artifactVersionId)
                    }
                    className="min-h-9 rounded-full border border-line px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    打开输出
                  </button>
                ) : null}
              </div>
              {output.preview?.kind === 'table' ? (
                <TablePreview preview={output.preview} />
              ) : null}
              {output.preview?.kind === 'chart' ? (
                <ChartPreview preview={output.preview} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
