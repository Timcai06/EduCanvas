/**
 * tooling 侧终端 pretty 渲染（.mjs 运行时专用）。
 *
 * 与 packages/logging/src/pretty-renderer.ts 保持同一套样式契约：
 * 时间弱化、service/level 定宽、warn 黄/error 红、成功事件绿、
 * 中文宽度按 2 计算；ANSI 只存在于展示层。协议常量经 log-protocol.mjs 共享。
 */

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const LEVEL_COLORS = {
  debug: DIM,
  info: '',
  warn: YELLOW,
  error: RED,
  fatal: RED,
};
const SUCCESS_EVENT_PATTERN =
  /(?:^|\.)(ready|completed|opened|accepted|started|stopped|checked|skipped)$/;

export function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width +=
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd))
        ? 2
        : 1;
  }
  return width;
}

export function padDisplay(text, width) {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + ' '.repeat(padding) : text;
}

function colorize(text, code) {
  return code === '' ? text : `${code}${text}${RESET}`;
}

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
    parts.push(key === 'durationMs' ? `${value}ms` : `${key}=${value}`);
  }
  return parts.length > 0 ? `  ${parts.join(' ')}` : '';
}

/** 渲染单条记录为终端行（多行错误块用 ↳ 缩进）。 */
export function renderRecord(record, { color = false } = {}) {
  const time = formatTime(record.ts ?? '');
  const level = String(record.level ?? 'info').toUpperCase();
  let line = color ? colorize(time, DIM) : time;
  line += `  ${padDisplay(String(record.service ?? '?').toUpperCase(), 7)}`;
  line += `  ${color ? colorize(padDisplay(level, 5), LEVEL_COLORS[record.level] ?? '') : padDisplay(level, 5)}`;
  const eventText = String(record.event ?? '');
  const eventColor = SUCCESS_EVENT_PATTERN.test(eventText) ? GREEN : DIM;
  line += `  ${color ? colorize(padDisplay(eventText, 28), eventColor) : padDisplay(eventText, 28)}`;
  line += `  ${record.message ?? ''}`;
  line += formatFields(record);
  if (record.error) {
    const error = record.error;
    const errorText = ` ↳ ${error.message ?? ''}${error.code ? ` · ${error.code}` : ''}${error.retryable === true ? ' · retryable' : ''}`;
    line += `\n${' '.repeat(27)} ${color ? colorize(errorText.trimStart(), RED) : errorText.trimStart()}`;
  }
  return line;
}

/** 阶段摘要行：✓/✗ + 名称 + 状态。 */
export function renderSummaryLine(
  symbol,
  label,
  detail,
  { color = false } = {},
) {
  const mark = color ? colorize(symbol, symbol === '✓' ? GREEN : RED) : symbol;
  return `${mark}  ${padDisplay(label, 12)} ${detail}`;
}
