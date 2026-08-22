#!/usr/bin/env node

/**
 * 跨平台日志查看器 — 读取当前/历史运行会话的 JSONL。
 *
 * 用法：
 *   node tooling/local/local-log-viewer.mjs [--service=X] [--level=Y] [--event=Z]
 *       [--op=ID] [--trace=ID] [--job=ID] [--run=runId] [--json] [--errors]
 *       [--tail=N] [--no-follow]
 *
 * 环境变量回退：SERVICE / LEVEL / EVENT / OP / TRACE / JOB / LOGS_JSON /
 * LOGS_ERRORS / TAIL / NO_FOLLOW（`make logs SERVICE=gateway` 即通过环境变量生效）。
 *
 * 纪律：JSON 模式只输出原始 JSONL，无颜色/说明文字；非 TTY 自动关闭颜色；
 * 尊重 NO_COLOR；follow 模式可被 Ctrl-C 干净终止；follow 从 EOF 字节偏移
 * 读取，历史记录只输出一次、追加记录只输出一次，不重读整个文件。
 */

import { existsSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { readLatest, DEFAULT_LOGS_ROOT } from './local-run-session.mjs';
import { renderRecord } from './local-pretty.mjs';
import { detectTerminalCapabilities } from '../terminal/capabilities.mjs';

// 颜色语义单一决策点（NO_COLOR/FORCE_COLOR/non-TTY），与 orchestrator 一致。
const { colorEnabled: capsColorEnabled } = detectTerminalCapabilities({
  stdout: process.stdout,
});

const HELP = `usage: local-log-viewer [--service=X] [--level=Y] [--event=Z] [--op=ID] [--trace=ID] [--job=ID] [--run=runId] [--json] [--errors] [--tail=N] [--no-follow]`;

function parseArgs(argv) {
  const options = {
    service: undefined,
    level: undefined,
    event: undefined,
    op: undefined,
    trace: undefined,
    job: undefined,
    run: undefined,
    json: false,
    errors: false,
    follow: true,
    tail: undefined,
  };
  const env = process.env;
  const envMap = {
    SERVICE: 'service',
    LEVEL: 'level',
    EVENT: 'event',
    OP: 'op',
    TRACE: 'trace',
    JOB: 'job',
    RUN: 'run',
  };
  for (const [envKey, optionKey] of Object.entries(envMap)) {
    if (env[envKey] !== undefined && env[envKey] !== '') {
      options[optionKey] = env[envKey];
    }
  }
  if (env.LOGS_JSON === '1') options.json = true;
  if (env.LOGS_ERRORS === '1') options.errors = true;
  if (env.NO_FOLLOW === '1') options.follow = false;
  if (env.TAIL !== undefined && env.TAIL !== '') {
    options.tail = Number(env.TAIL);
  }
  const invalidTail = () => {
    process.stderr.write(`无效的 --tail 值（需要正整数）\n${HELP}\n`);
    process.exit(2);
  };
  if (
    options.tail !== undefined &&
    (!Number.isInteger(options.tail) || options.tail < 0)
  )
    invalidTail();
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (key) {
      case '--service':
        options.service = value;
        break;
      case '--level':
        options.level = value;
        break;
      case '--event':
        options.event = value;
        break;
      case '--op':
        options.op = value;
        break;
      case '--trace':
        options.trace = value;
        break;
      case '--job':
        options.job = value;
        break;
      case '--run':
        options.run = value;
        break;
      case '--json':
        options.json = true;
        break;
      case '--errors':
        options.errors = true;
        break;
      case '--no-follow':
        options.follow = false;
        break;
      case '--tail':
        options.tail = Number(value);
        if (!Number.isInteger(options.tail) || options.tail < 0) invalidTail();
        break;
      case '--help':
      case '-h':
        process.stdout.write(`${HELP}\n`);
        process.exit(0);
        break;
      default:
        process.stderr.write(`未知参数: ${key}\n${HELP}\n`);
        process.exit(2);
    }
  }
  return options;
}

function matchesFilters(record, options) {
  if (
    options.service &&
    String(record.service).toLowerCase() !== options.service.toLowerCase()
  )
    return false;
  if (
    options.level &&
    String(record.level).toLowerCase() !== options.level.toLowerCase()
  )
    return false;
  if (options.event && !String(record.event).includes(options.event))
    return false;
  if (
    options.op &&
    record.operationId !== options.op &&
    !String(record.operationId ?? '').includes(options.op)
  )
    return false;
  if (
    options.trace &&
    record.traceId !== options.trace &&
    !String(record.traceId ?? '').includes(options.trace)
  )
    return false;
  if (
    options.job &&
    record.jobId !== options.job &&
    !String(record.jobId ?? '').includes(options.job)
  )
    return false;
  if (options.errors && record.level !== 'error' && record.level !== 'fatal')
    return false;
  return true;
}

async function resolveRunDirectory(options) {
  if (options.run) {
    const directory = path.join(DEFAULT_LOGS_ROOT, options.run);
    if (!existsSync(directory)) {
      throw new Error(`运行会话不存在: ${directory}`);
    }
    return directory;
  }
  const latest = await readLatest(DEFAULT_LOGS_ROOT);
  if (!latest?.runId) {
    throw new Error(
      '没有找到本地运行会话（tmp/logs/local/latest.json 缺失）。请先执行 make all。',
    );
  }
  return path.join(DEFAULT_LOGS_ROOT, latest.runId);
}

/**
 * 读取全部行（combined.jsonl；service 作为过滤条件而非文件选择）；tail>0 时
 * 只取最近 N 行。返回 { lines, offset }：offset 是「首屏已消费内容」的字节
 * 长度，follow 从该位置继续，避免首屏与首个 follow tick 之间追加的记录被吞。
 */
function readLines(runDirectory, tail) {
  const file = path.join(runDirectory, 'combined.jsonl');
  if (!existsSync(file)) return { lines: [], offset: 0 };
  const content = readFileSync(file, 'utf8');
  // 按字节精确扫描行边界（保留每行起始/结束偏移），多字节字符与空行
  // 不会造成 offset 漂移。
  const entries = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      const raw = content.slice(start, i);
      if (raw.trim() !== '') entries.push({ text: raw, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < content.length) {
    const raw = content.slice(start);
    if (raw.trim() !== '') entries.push({ text: raw, end: content.length });
  }
  const consumed =
    typeof tail === 'number' && tail > 0 ? entries.slice(-tail) : entries;
  const consumedEnd =
    consumed.length > 0 ? consumed[consumed.length - 1].end : 0;
  return {
    lines: consumed.map((entry) => entry.text),
    offset: Buffer.byteLength(content.slice(0, consumedEnd)),
  };
}

/**
 * 打开 follow 读取器。startOffset 缺省时取「当前文件大小」作为起始偏移；
 * 调用方（main）传入首屏已消费字节数时，首屏与首次 tick 之间的追加内容
 * 不会被吞掉。之后只读取 [offset, size) 的追加字节，绝不重新读整个 JSONL
 * （日志越大越关键）。
 */
export async function openFollowReader(filePath, startOffset = null) {
  const handle = await open(filePath, 'r');
  const { size } = await handle.stat();
  return { handle, offset: startOffset ?? size };
}

/** 读取自上次 offset 以来的追加字节并推进 offset；无新增返回 ''。 */
export async function readFollowed(reader) {
  const { size } = await reader.handle.stat();
  if (size <= reader.offset) return '';
  const buffer = Buffer.alloc(size - reader.offset);
  const { bytesRead } = await reader.handle.read(
    buffer,
    0,
    buffer.length,
    reader.offset,
  );
  reader.offset = size;
  return buffer.toString('utf8', 0, bytesRead);
}

function outputRecord(line, options) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return; // 损坏行静默跳过（文件本身由协议保证可解析）。
  }
  if (!matchesFilters(record, options)) return;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } else {
    process.stdout.write(
      `${renderRecord(record, { color: capsColorEnabled })}\n`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDirectory = await resolveRunDirectory(options);

  // 首屏：完整历史（或 tail 子集），只输出一次。offset 是首屏已消费字节数，
  // follow 从该位置继续——首屏与首个 tick 之间的追加内容不会被吞。
  const { lines, offset } = readLines(runDirectory, options.tail);
  for (const line of lines) outputRecord(line, options);

  // follow：仅当日志目录仍属于运行中的会话时轮询追加。起始偏移取首屏
  // 之后的文件大小，因此历史记录绝不会被重复输出。
  if (options.follow && !options.run) {
    const latest = await readLatest(DEFAULT_LOGS_ROOT);
    const stillCurrent =
      latest?.runId !== undefined &&
      path.basename(runDirectory) === latest.runId &&
      latest.state === 'running';
    if (!stillCurrent) return;

    const file = path.join(runDirectory, 'combined.jsonl');
    let reader = null;
    const ensureReader = async () => {
      if (reader !== null) return true;
      if (!existsSync(file)) return false;
      try {
        reader = await openFollowReader(file, offset);
        return true;
      } catch {
        return false;
      }
    };
    const tick = async () => {
      if (!(await ensureReader())) return;
      const slice = await readFollowed(reader);
      for (const line of slice.split('\n')) {
        if (line.trim() !== '') outputRecord(line, options);
      }
    };
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => process.exit(0));
    }
    await tick();
    const timer = setInterval(() => void tick(), 500);
    // 注意：不可 unref——unref 后若 pending promise 是唯一存活句柄，Node
    // 会在首屏后立即退出，follow 永不生效。
    await new Promise(() => undefined);
  }
}

// 仅以 CLI 入口方式执行时运行 main()：测试通过 import 复用
// openFollowReader/readFollowed，导入不得触发真实日志读取/follow 副作用。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `[logs] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
