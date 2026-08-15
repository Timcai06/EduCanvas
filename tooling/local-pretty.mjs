/**
 * tooling 侧终端 pretty 渲染（.mjs 运行时专用）。
 *
 * 与 packages/logging/src/pretty-renderer.ts 保持同一套样式契约：
 * 时间弱化、service/level 定宽、warn 黄/error 红、成功事件绿、
 * 中文宽度按 2 计算；ANSI 只存在于展示层。
 *
 * 颜色一律走语义 token（./terminal/theme.mjs），宽度/时长/路径工具走
 * ./terminal/format.mjs，符号走 ./terminal/glyphs.mjs。
 * 协议常量经 log-protocol.mjs 共享。
 */

import { paint } from './terminal/theme.mjs';
import { GLYPHS } from './terminal/glyphs.mjs';
import {
  displayWidth,
  formatDuration,
  padDisplay,
  truncateDisplay,
} from './terminal/format.mjs';

export { displayWidth, padDisplay, truncateDisplay };

const LEVEL_TOKENS = {
  debug: 'dim',
  info: null,
  warn: 'warning',
  error: 'error',
  fatal: 'error',
};
const SUCCESS_EVENT_PATTERN =
  /(?:^|\.)(ready|completed|opened|accepted|started|stopped|checked|skipped)$/;

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso).slice(11, 23);
  const pad = (value) => String(value).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}`;
}

const FIELD_ORDER = [
  'method',
  'route',
  'status',
  'durationMs',
  'operationId',
  'jobId',
  'taskIdentifier',
  'attempt',
  'maxAttempts',
  'workerId',
  'requestId',
  'traceId',
  'taskCount',
  'concurrency',
  'pollIntervalMs',
  'port',
];

function formatFields(record) {
  const parts = [];
  for (const key of FIELD_ORDER) {
    const value = record[key];
    if (value === undefined) continue;
    parts.push(
      key === 'durationMs' ? formatDuration(value) : `${key}=${value}`,
    );
  }
  return parts.length > 0 ? `  ${parts.join(` ${GLYPHS.dot} `)}` : '';
}

/**
 * 逐行按显示宽度截断。超宽行先剥离 ANSI 再截断（截断后的行是纯文本，
 * 保证管道/窄终端下不出现残缺的颜色序列）。
 */
function applyLineLimit(line, maxLineWidth) {
  if (maxLineWidth === undefined) return line;
  return line
    .split('\n')
    .map((segment) => {
      if (displayWidth(segment) <= maxLineWidth) return segment;
      const plain = segment.replace(/\x1b\[[0-9;]*m/g, '');
      return truncateDisplay(plain, maxLineWidth);
    })
    .join('\n');
}

/** 渲染单条记录为终端行（多行错误块用 ↳ 缩进）。 */
export function renderRecord(record, { color = false, maxLineWidth } = {}) {
  const time = formatTime(record.ts ?? '');
  const level = String(record.level ?? 'info').toUpperCase();
  let line = color ? paint('dim', time) : time;
  line += `  ${padDisplay(String(record.service ?? '?').toUpperCase(), 7)}`;
  const levelText = padDisplay(level, 5);
  const levelToken = LEVEL_TOKENS[record.level] ?? null;
  line += `  ${color && levelToken ? paint(levelToken, levelText) : levelText}`;
  const eventText = String(record.event ?? '');
  const eventToken = SUCCESS_EVENT_PATTERN.test(eventText) ? 'success' : 'dim';
  line += `  ${color ? paint(eventToken, padDisplay(eventText, 28)) : padDisplay(eventText, 28)}`;
  line += `  ${record.message ?? ''}`;
  line += formatFields(record);
  if (record.error) {
    const error = record.error;
    const errorText = ` ↳ ${error.message ?? ''}${error.code ? ` ${GLYPHS.dot} ${error.code}` : ''}${error.retryable === true ? ` ${GLYPHS.dot} retryable` : ''}`;
    line += `\n${' '.repeat(27)} ${color ? paint('error', errorText.trimStart()) : errorText.trimStart()}`;
  }
  return applyLineLimit(line, maxLineWidth);
}

/** 阶段摘要行：✓/✗ + 名称 + 状态。 */
export function renderSummaryLine(
  symbol,
  label,
  detail,
  { color = false } = {},
) {
  const mark = color
    ? paint(symbol === GLYPHS.ok ? 'success' : 'error', symbol)
    : symbol;
  return `${mark}  ${padDisplay(label, 12)} ${detail}`;
}
