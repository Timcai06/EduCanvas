/**
 * 启动失败摘要渲染 — 「成功路径摘要化，失败路径详细化」。
 *
 * 纪律：
 * - 不倾倒所有服务日志；默认展示失败服务最近 20~40 条相关记录；
 * - 显示首个 fatal/error、退出码/signal、完整日志位置；
 * - 失败详情必须来自真实错误；无法确定建议时只给检查命令，不编造根因。
 */

import path from 'node:path';
import { LOG_SCHEMA } from './log-protocol.mjs';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

function color(text, code) {
  return code === '' ? text : `${code}${text}${RESET}`;
}

/** 从记录中提取首个 error/fatal 级别记录。 */
export function firstFailure(records) {
  if (!records) return undefined;
  return records.find(
    (record) => record.level === 'fatal' || record.level === 'error',
  );
}

/** 从记录中提取退出信息（优先 process.exit 事件，其次 service.failed）。 */
export function extractExitInfo(records) {
  if (!records) return undefined;
  const exitRecord =
    records.find((record) => record.event === 'process.exit') ??
    records.find((record) => record.event === 'service.failed');
  if (!exitRecord) return undefined;
  const code = exitRecord.code ?? exitRecord.exitCode;
  const signal = exitRecord.signal;
  return { code, signal };
}

/**
 * 渲染失败摘要。input：
 * - stages: [{ label, ok, detail }] 各阶段结果
 * - failures: [{ service, reason, exitCode, signal }]
 * - recentRecords: { service: records[] }（最近记录，按时间序）
 * - logDirectory: 完整日志目录
 * - suggestedCommands: string[]
 */
export function renderFailureSummary(input, { colorEnabled = false } = {}) {
  const {
    stages = [],
    failures,
    recentRecords = {},
    logDirectory,
    suggestedCommands = [],
  } = input;
  const lines = [];
  const c = (text, code) => (colorEnabled ? color(text, code) : text);

  lines.push('EduCanvas · Startup failed');
  lines.push(c('─'.repeat(56), DIM));
  lines.push('');
  for (const stage of stages) {
    const mark = stage.ok ? '✓' : '✗';
    const markColor = stage.ok ? GREEN : RED;
    lines.push(
      `  ${c(mark, markColor)}  ${stage.label.padEnd(12)} ${stage.detail ?? ''}`.trimEnd(),
    );
  }
  lines.push('');

  if (failures.length > 0) {
    for (const failure of failures) {
      lines.push(
        `  ${c('Error', YELLOW).padEnd(12)} ${failure.reason ?? '未知错误'}`,
      );
      if (failure.service !== undefined) {
        lines.push(`  ${c('Service', DIM).padEnd(12)} ${failure.service}`);
      }
      if (failure.exitCode !== undefined || failure.signal !== undefined) {
        lines.push(
          `  ${c('Exit', DIM).padEnd(12)} code=${failure.exitCode ?? '-'} signal=${failure.signal ?? '-'}`,
        );
      }
    }
    lines.push(`  ${c('Log', DIM).padEnd(12)} ${logDirectory ?? ''}`);
  }

  // 失败服务最近记录摘要（只含失败服务，最多 40 条）。
  for (const [service, records] of Object.entries(recentRecords)) {
    if (!records || records.length === 0) continue;
    lines.push('');
    lines.push(`  Recent ${service} events:`);
    lines.push('');
    const tail = records.slice(-40);
    for (const record of tail) {
      const time = (record.ts ?? '').slice(11, 23);
      const level = record.level.toUpperCase().padEnd(5);
      const levelColor =
        record.level === 'error' || record.level === 'fatal' ? RED : DIM;
      const base = `  ${time}  ${record.service.toUpperCase().padEnd(7)} ${c(level, levelColor)}  ${record.event}`;
      lines.push(base);
      if (record.error) {
        lines.push(
          `  ${' '.repeat(20)} ↳ ${c(record.error.message, RED)}${record.error.code ? ` · ${record.error.code}` : ''}`,
        );
      } else if (record.message && record.event !== 'process.output') {
        lines.push(`  ${' '.repeat(20)} ↳ ${record.message}`);
      }
    }
  }

  if (suggestedCommands.length > 0) {
    lines.push('');
    lines.push('  Suggested action:');
    for (const command of suggestedCommands) {
      lines.push(`  ${c(command, YELLOW)}`);
    }
  }
  return lines.join('\n');
}

/** 生成失败摘要的文本版（无 ANSI），供测试与 NO_COLOR 场景。 */
export function renderFailureSummaryPlain(input) {
  return renderFailureSummary(input, { colorEnabled: false });
}

export { LOG_SCHEMA, path };
