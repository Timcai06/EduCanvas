#!/usr/bin/env node

/**
 * 跨平台日志查看器 — 读取当前/历史运行会话的 JSONL。
 *
 * 用法：
 *   node tooling/local-log-viewer.mjs [--service=X] [--level=Y] [--event=Z]
 *       [--op=ID] [--trace=ID] [--job=ID] [--run=runId] [--json] [--errors]
 *
 * 环境变量回退：SERVICE / LEVEL / EVENT / OP / TRACE / JOB / LOGS_JSON / LOGS_ERRORS
 * （`make logs SERVICE=gateway` 即通过环境变量生效）。
 *
 * 纪律：JSON 模式只输出原始 JSONL，无颜色/说明文字；非 TTY 自动关闭颜色；
 * 尊重 NO_COLOR；follow 模式可被 Ctrl-C 干净终止。
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { readLatest, DEFAULT_LOGS_ROOT } from './local-run-session.mjs';
import { renderRecord } from './local-pretty.mjs';

const HELP = `usage: local-log-viewer [--service=X] [--level=Y] [--event=Z] [--op=ID] [--trace=ID] [--job=ID] [--run=runId] [--json] [--errors]`;

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

function colorEnabled() {
  return (
    process.env.NO_COLOR === undefined &&
    process.env.NO_COLOR !== '' &&
    process.stdout.isTTY &&
    process.env.FORCE_COLOR !== '0'
  );
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

/** 读取全部行（combined.jsonl；service 作为过滤条件而非文件选择）。 */
function readLines(runDirectory) {
  const file = path.join(runDirectory, 'combined.jsonl');
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  return content.split('\n').filter((line) => line.trim() !== '');
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
      `${renderRecord(record, { color: colorEnabled() })}\n`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDirectory = await resolveRunDirectory(options);

  const lines = readLines(runDirectory);
  for (const line of lines) outputRecord(line, options);

  // follow：仅当日志目录仍属于运行中的会话时轮询追加。
  if (options.follow && !options.run) {
    const latest = await readLatest(DEFAULT_LOGS_ROOT);
    const stillCurrent =
      latest?.runId !== undefined &&
      path.basename(runDirectory) === latest.runId &&
      latest.state === 'running';
    if (!stillCurrent) return;

    let offset = 0;
    const file = path.join(runDirectory, 'combined.jsonl');
    const tick = async () => {
      if (!existsSync(file)) return;
      const content = await readFile(file, 'utf8');
      const slice = content.slice(offset);
      offset = content.length;
      for (const line of slice.split('\n')) {
        if (line.trim() !== '') outputRecord(line, options);
      }
    };
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => process.exit(0));
    }
    await tick();
    const timer = setInterval(() => void tick(), 500);
    timer.unref();
    // 保持进程存活直到被信号终止。
    await new Promise(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(
    `[logs] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
