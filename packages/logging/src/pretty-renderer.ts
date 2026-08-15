import type { EduCanvasLogRecord } from './types.js';

/**
 * 终端 pretty renderer — 只存在于展示层，ANSI 绝不进入日志文件。
 *
 * 风格约束（克制、清晰）：
 * - 时间弱化（dim）；service/level 固定宽度；
 * - warn 黄色、error/fatal 红色、ready 类成功事件绿色，但不只依赖颜色表达成功；
 * - 路径/ID/端口弱化色；不使用 emoji/渐变/巨型 ASCII；
 * - 中文按显示宽度 2 计算对齐，不能直接用 padEnd 假设宽度 1。
 */

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

const LEVEL_COLORS: Record<string, string> = {
  debug: DIM,
  info: '',
  warn: YELLOW,
  error: RED,
  fatal: RED,
};

const SUCCESS_EVENT_PATTERN =
  /(?:^|\.)(ready|completed|opened|accepted|started|stopped|checked|skipped)$/;

/** CJK 及其他宽字符按 2 格计算显示宽度；其余按 1。 */
export function displayWidth(text: string): number {
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

/** 按显示宽度填充到目标宽度（中文正确处理）。 */
export function padDisplay(text: string, width: number): string {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + ' '.repeat(padding) : text;
}

/** 截断到显示宽度上限（避免破坏中文字符）。 */
export function truncateDisplay(text: string, width: number): string {
  let current = 0;
  let index = 0;
  for (const char of [...text]) {
    const charWidth = displayWidth(char);
    if (current + charWidth > width) break;
    current += charWidth;
    index += 1;
  }
  const chars = [...text];
  return index < chars.length ? `${chars.slice(0, index).join('')}…` : text;
}

export interface RenderOptions {
  color: boolean;
  /** 时间戳显示为本地时区 HH:MM:SS.mmm；否则完整 ISO。 */
  localTime?: boolean;
  maxLineWidth?: number;
}

function formatTime(iso: string, local: boolean): string {
  const date = new Date(iso);
  if (!local) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}`;
}

function colorize(text: string, code: string): string {
  return code === '' ? text : `${code}${text}${RESET}`;
}

function formatFields(record: EduCanvasLogRecord): string {
  const parts: string[] = [];
  const fieldOrder = [
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
  for (const key of fieldOrder) {
    const value = record[key];
    if (value === undefined) continue;
    if (key === 'durationMs') parts.push(`${value}ms`);
    else parts.push(`${key}=${String(value)}`);
  }
  return parts.length > 0 ? `  ${parts.join(' ')}` : '';
}

/** 渲染单条记录为终端行。 */
export function renderRecord(
  record: EduCanvasLogRecord,
  options: RenderOptions,
): string {
  const color = options.color;
  const time = formatTime(record.ts, options.localTime ?? true);
  const level = record.level.toUpperCase();

  let line = color ? colorize(time, DIM) : time;
  line += `  ${padDisplay(record.service.toUpperCase(), 7)}`;
  line += `  ${padDisplay(color ? colorize(level, LEVEL_COLORS[record.level] ?? '') : level, 5)}`;
  const eventText = record.event;
  const eventColor = SUCCESS_EVENT_PATTERN.test(record.event) ? GREEN : DIM;
  line += `  ${color ? colorize(padDisplay(eventText, 28), eventColor) : padDisplay(eventText, 28)}`;
  line += `  ${record.message}`;
  line += formatFields(record);

  if (record.error) {
    const error = record.error;
    const errorText = ` ↳ ${error.message}${error.code ? ` · ${error.code}` : ''}${error.retryable === true ? ' · retryable' : ''}`;
    line += `\n${' '.repeat(27)} ${color ? colorize(errorText.trimStart(), RED) : errorText.trimStart()}`;
  }
  return line;
}

/**
 * 渲染「启动阶段摘要」行（✓/✗ + 名称 + 状态），绿色只用于成功且不依赖颜色。
 */
export function renderSummaryLine(
  symbol: string,
  label: string,
  detail: string,
  options: { color: boolean },
): string {
  const color = options.color;
  const mark = color ? colorize(symbol, symbol === '✓' ? GREEN : RED) : symbol;
  return `${mark}  ${padDisplay(label, 12)} ${detail}`;
}

export { SUCCESS_EVENT_PATTERN };
