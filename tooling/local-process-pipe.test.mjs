import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLineSplitter,
  MAX_PENDING_CHUNK,
  parseProcessLine,
  tryParseLogRecord,
} from './local-process-pipe.mjs';

test('line splitter 按行切分跨 chunk 的行', () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  splitter.push('{"a":1}\n{"b"');
  splitter.push(':2}\n{"c":3}\n');
  splitter.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('line splitter 剥离 \\r 结尾（Windows 行尾）', () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  splitter.push('line1\r\nline2\r\n');
  splitter.end();
  assert.deepEqual(lines, ['line1', 'line2']);
});

test('未换行残留在 end() 时输出', () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  splitter.push('tail-without-newline');
  splitter.end();
  assert.deepEqual(lines, ['tail-without-newline']);
});

test('超长 pending 不无限缓存：强制切行并清空缓冲', () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  splitter.push('x'.repeat(MAX_PENDING_CHUNK + 100));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length <= 4_000);
  splitter.end();
  assert.equal(lines.length, 1);
});

test('标准协议 JSON 行被识别', () => {
  const record = tryParseLogRecord(
    '{"schema":"educanvas.log.v1","ts":"2026-08-14T18:23:39.102Z","level":"info","service":"worker","event":"worker.ready","message":"ok"}',
  );
  assert.equal(record.event, 'worker.ready');
});

test('非 JSON / 非协议行返回 null', () => {
  assert.equal(tryParseLogRecord('plain text'), null);
  assert.equal(tryParseLogRecord('{"schema":"other"}'), null);
  assert.equal(tryParseLogRecord(''), null);
  assert.equal(tryParseLogRecord('{broken json'), null);
});

test('legacy 文本包装为 process.output 记录，单行非 JSON 不崩溃', () => {
  const record = parseProcessLine('  some legacy log  ', {
    service: 'web',
    stream: 'stderr',
  });
  assert.equal(record.schema, 'educanvas.log.v1');
  assert.equal(record.event, 'process.output');
  assert.equal(record.component, 'legacy');
  assert.equal(record.stream, 'stderr');
  assert.equal(record.service, 'web');
  assert.equal(record.level, 'warn');
});

test('协议行内 service 被进程绑定覆盖（防伪造）', () => {
  const record = parseProcessLine(
    '{"schema":"educanvas.log.v1","ts":"2026-08-14T18:23:39.102Z","level":"info","service":"worker","event":"worker.ready","message":"ok"}',
    { service: 'web', stream: 'stdout' },
  );
  assert.equal(record.service, 'web');
});

test('超长 legacy 行被截断', () => {
  const record = parseProcessLine('y'.repeat(10_000), {
    service: 'worker',
    stream: 'stdout',
  });
  assert.ok(record.message.length <= 4_000);
});

test('legacy 行 ANSI 转义被剥离，绝不进入 JSONL', () => {
  const record = parseProcessLine('\x1b[32m ready \x1b[0m\x1b[1mbold\x1b[22m', {
    service: 'web',
    stream: 'stdout',
  });
  assert.ok(!record.message.includes('\x1b['));
  assert.equal(record.message, ' ready bold');
});

test('legacy 行 Authorization/Bearer 凭据被脱敏', () => {
  const record = parseProcessLine('Authorization: Bearer sk-abc12345', {
    service: 'gateway',
    stream: 'stderr',
  });
  assert.match(record.message, /\[REDACTED\]/);
  assert.ok(!record.message.includes('sk-abc12345'));
});

test('legacy 行 DATABASE_URL 连接串被脱敏', () => {
  const record = parseProcessLine(
    'DATABASE_URL=postgresql://educanvas:secret@127.0.0.1:5434/educanvas',
    { service: 'worker', stream: 'stdout' },
  );
  assert.match(record.message, /DATABASE_URL=\[REDACTED\]/);
  assert.ok(!record.message.includes('postgresql://'));
  assert.ok(!record.message.includes('secret'));
});

test('legacy 行 URL 内嵌凭据被脱敏', () => {
  const record = parseProcessLine(
    'fetching https://user:pass@example.com/api',
    {
      service: 'web',
      stream: 'stdout',
    },
  );
  assert.match(record.message, /\/\/\[REDACTED\]@example\.com/);
  assert.ok(!record.message.includes('user:pass'));
});

test('普通 legacy 文本不受影响（不误伤）', () => {
  const record = parseProcessLine('Compiled successfully in 1.2s', {
    service: 'web',
    stream: 'stdout',
  });
  assert.equal(record.message, 'Compiled successfully in 1.2s');
});
