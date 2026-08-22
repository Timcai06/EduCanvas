/**
 * tooling/local/local-pretty.mjs 的类型声明 — 供 packages/logging 的契约测试
 * （tooling-parity.test.ts）导入；tooling 自身是 .mjs 运行时，不依赖本文件。
 */

export interface PrettyLogRecord {
  ts?: string;
  level?: string;
  service?: string;
  event?: string;
  message?: string;
  error?: { message?: string; code?: string; retryable?: boolean };
  [key: string]: unknown;
}

export function renderRecord(
  record: PrettyLogRecord,
  options?: { color?: boolean },
): string;

export function renderSummaryLine(
  symbol: string,
  label: string,
  detail: string,
  options?: { color?: boolean },
): string;

export function displayWidth(text: string): number;

export function padDisplay(text: string, width: number): string;
