/**
 * 启动摘要渲染 — 「成功路径摘要化，失败路径详细化」。
 *
 * 纪律：
 * - 不倾倒所有服务日志；默认展示失败服务最近 20~40 条相关记录；
 * - 显示首个 fatal/error、退出码/signal、完整日志位置；
 * - 失败详情必须来自真实错误；无法确定建议时只给检查命令，不编造根因；
 * - 颜色只走语义 token（./terminal/theme.mjs），符号走 ./terminal/glyphs.mjs。
 */

import path from 'node:path';
import { renderSummaryLine } from './local-pretty.mjs';
import { LOG_SCHEMA } from './log-protocol.mjs';
import { paint } from './terminal/theme.mjs';
import { GLYPHS, SUMMARY_RULE } from './terminal/glyphs.mjs';
import {
  displayWidth,
  formatDuration,
  padDisplay,
  shortenPath,
} from './terminal/format.mjs';

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
 * - logDirectory: 完整日志目录（失败摘要永远显示完整路径，不缩写）
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
  const c = (text, token) => (colorEnabled ? paint(token, text) : text);

  lines.push(`${c(GLYPHS.fail, 'error')} EduCanvas · Startup failed`);
  lines.push(c(SUMMARY_RULE, 'dim'));
  lines.push('');
  for (const stage of stages) {
    const mark = stage.ok ? GLYPHS.ok : GLYPHS.fail;
    const markColor = stage.ok ? 'success' : 'error';
    lines.push(
      `  ${c(mark, markColor)}  ${stage.label.padEnd(12)} ${stage.detail ?? ''}`.trimEnd(),
    );
  }
  lines.push('');

  if (failures.length > 0) {
    for (const failure of failures) {
      lines.push(
        `  ${c('Error', 'warning').padEnd(12)} ${failure.reason ?? '未知错误'}`,
      );
      if (failure.service !== undefined) {
        lines.push(`  ${c('Service', 'dim').padEnd(12)} ${failure.service}`);
      }
      if (failure.exitCode !== undefined || failure.signal !== undefined) {
        lines.push(
          `  ${c('Exit', 'dim').padEnd(12)} code=${failure.exitCode ?? '-'} signal=${failure.signal ?? '-'}`,
        );
      }
    }
    lines.push(`  ${c('Log', 'dim').padEnd(12)} ${logDirectory ?? ''}`);
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
        record.level === 'error' || record.level === 'fatal' ? 'error' : 'dim';
      const base = `  ${time}  ${record.service.toUpperCase().padEnd(7)} ${c(level, levelColor)}  ${record.event}`;
      lines.push(base);
      if (record.error) {
        lines.push(
          `  ${' '.repeat(20)} ${GLYPHS.indent} ${c(record.error.message, 'error')}${record.error.code ? ` ${GLYPHS.dot} ${record.error.code}` : ''}`,
        );
      } else if (record.message && record.event !== 'process.output') {
        lines.push(`  ${' '.repeat(20)} ${GLYPHS.indent} ${record.message}`);
      }
    }
  }

  if (suggestedCommands.length > 0) {
    lines.push('');
    lines.push('  Suggested action:');
    for (const command of suggestedCommands) {
      lines.push(`  ${c(command, 'warning')}`);
    }
  }
  return lines.join('\n');
}

/** 生成失败摘要的文本版（无 ANSI），供测试与 NO_COLOR 场景。 */
export function renderFailureSummaryPlain(input) {
  return renderFailureSummary(input, { colorEnabled: false });
}

export { LOG_SCHEMA, path };

/**
 * 启动阶段摘要渲染（成功路径）。
 * stages: [{ label, ok, detail, durationMs? }] — durationMs 可选，
 * 存在时右对齐到同一列；ready-in 取各阶段最大时长。
 */
export function printStartupSummary({
  stages,
  session,
  webUrl,
  gatewayUrl,
  colorEnabled,
  out,
}) {
  const c = (text, token) => (colorEnabled ? paint(token, text) : text);
  const detailCol = Math.max(
    0,
    ...stages.map((s) => displayWidth(s.detail ?? '')),
  );
  const durations = stages
    .map((s) => s.durationMs)
    .filter((ms) => typeof ms === 'number');
  const durationCol = Math.max(
    0,
    ...durations.map((ms) => formatDuration(ms).length),
  );
  const readyIn =
    durations.length > 0 ? formatDuration(Math.max(...durations)) : '';

  out('');
  out(`${c(GLYPHS.brand, 'brand')} EduCanvas · Local Runtime`);
  out(c(SUMMARY_RULE, 'dim'));
  out('');
  for (const stage of stages) {
    const mark = stage.ok ? GLYPHS.ok : GLYPHS.fail;
    const markColor = stage.ok ? 'success' : 'error';
    const duration =
      typeof stage.durationMs === 'number'
        ? formatDuration(stage.durationMs).padStart(durationCol)
        : '';
    out(
      `  ${c(mark, markColor)}  ${padDisplay(stage.label, 10)} ${padDisplay(stage.detail ?? '', detailCol)}${duration ? `  ${c(duration, 'dim')}` : ''}`,
    );
  }
  if (readyIn) {
    out('');
    out(`  ${c(`ready in ${readyIn}`, 'success')}`);
  }
  out('');
  out(`  Logs      ${shortenPath(session.directory)}`);
  out('');
  out('  make logs · make status · ^C stop');
}

/**
 * 构建失败摘要输入：真实错误 + 失败/未就绪服务的最近记录。
 */
export function buildFailure({ stages, session, services, error }) {
  const message = error instanceof Error ? error.message : String(error);
  const failures = [];
  // 首个失败条目优先携带真实错误（readiness 退出/超时/fatal 原因）。
  if (message !== '') failures.push({ reason: message });
  if (services !== null) {
    for (const service of Object.values(services)) {
      if (!service.ready && service.fatalError) {
        failures.push({
          service: service.name,
          reason: service.fatalError.message,
          exitCode: service.exitCode,
        });
      }
    }
  }
  if (failures.length === 0) failures.push({ reason: '未知错误' });
  const recentRecords = {};
  if (services !== null) {
    for (const [name, service] of Object.entries(services)) {
      // 摘要只包含失败/未就绪的服务，不倾倒已就绪服务的无关日志。
      if (!service.ready && service.recent.length > 0) {
        recentRecords[name] = service.recent;
      }
    }
  }
  const errorText = error instanceof Error ? error.message : String(error);
  const suggestedCommands = [];
  if (/DATABASE_URL/.test(errorText))
    suggestedCommands.push('pnpm env:check .env');
  if (/端口|port|EADDRINUSE|占用/.test(errorText)) {
    suggestedCommands.push('检查并释放占用端口后重试');
  }
  if (suggestedCommands.length === 0)
    suggestedCommands.push('make status', '查看日志目录中的失败服务 jsonl');
  return {
    stages,
    failures,
    recentRecords,
    logDirectory: session?.directory ?? '',
    suggestedCommands,
  };
}
