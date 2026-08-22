import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  printStartupSummary,
  renderFailureSummary,
} from '../local/local-startup-report.mjs';
import { renderRecord, renderSummaryLine } from '../local/local-pretty.mjs';
import { renderStatusCard } from '../local/local-runtime-ops.mjs';
import { GLYPHS, SUMMARY_RULE } from './glyphs.mjs';
import { padDisplay } from './format.mjs';

/** 收集 printStartupSummary 输出的行。 */
function captureStartup(options) {
  const lines = [];
  printStartupSummary({ out: (line) => lines.push(line), ...options });
  return lines;
}

const successStages = [
  { label: 'Environment', ok: true, detail: 'Node v24.18.0 · Docker ready' },
  { label: 'Database', ok: true, detail: 'PostgreSQL', durationMs: 840 },
  { label: 'Migration', ok: true, detail: 'schema current', durationMs: 1200 },
  {
    label: 'Gateway',
    ok: true,
    detail: 'http://127.0.0.1:3200',
    durationMs: 3000,
  },
  { label: 'Web', ok: true, detail: 'http://127.0.0.1:3000', durationMs: 5100 },
  { label: 'Worker', ok: true, detail: 'ready', durationMs: 2500 },
];

const session = {
  directory: path.join(
    process.cwd(),
    'tmp',
    'logs',
    'local',
    'local-20260815-112821-0e58',
  ),
};

test('golden: 启动摘要头部与品牌符号', () => {
  const lines = captureStartup({
    stages: successStages,
    session,
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: false,
  });
  // 首行为空行，头部在 index 1。
  assert.equal(lines[0], '');
  assert.match(
    lines[1],
    new RegExp(`^${GLYPHS.brand} EduCanvas · Local Runtime$`),
  );
  assert.equal(lines[2], SUMMARY_RULE);
});

test('golden: 启动摘要无颜色时无 ANSI，色深对齐', () => {
  const lines = captureStartup({
    stages: successStages,
    session,
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: false,
  });
  assert.ok(lines.every((line) => !line.includes('\x1b[')));
  const dbRow = lines.find((line) => line.includes('Database'));
  assert.match(dbRow, /PostgreSQL/);
  assert.match(dbRow, /840ms$/); // 时长右对齐到列尾（<1s 保持 ms）
  const gatewayRow = lines.find((line) => line.includes('Gateway'));
  assert.match(gatewayRow, /3\.00s$/);
});

test('golden: 启动摘要 ready-in 取最大阶段时长', () => {
  const lines = captureStartup({
    stages: successStages,
    session,
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: false,
  });
  assert.ok(lines.some((line) => line === '  ready in 5.10s'));
});

test('golden: 启动摘要日志路径仓库内相对缩写 + 提示行', () => {
  const lines = captureStartup({
    stages: successStages,
    session,
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: false,
  });
  assert.ok(
    lines.some(
      (line) =>
        line === '  Logs      tmp/logs/local/local-20260815-112821-0e58',
    ),
  );
  assert.ok(
    lines.some((line) => line === '  make logs · make status · ^C stop'),
  );
});

test('golden: 启动摘要彩色模式只上语义 token 色', () => {
  const lines = captureStartup({
    stages: successStages,
    session,
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: true,
  });
  assert.match(lines[1], /\x1b\[34m◆\x1b\[0m EduCanvas · Local Runtime/);
  const dbRow = lines.find((line) => line.includes('Database'));
  assert.match(dbRow, /\x1b\[32m✓\x1b\[0m/); // success token
  assert.match(dbRow, /\x1b\[2m840ms\x1b\[0m/); // dim token
});

test('golden: 失败摘要头部、失败原因与完整日志路径', () => {
  const text = renderFailureSummary({
    stages: [
      { label: 'Database', ok: true, detail: 'ready' },
      { label: 'Worker', ok: false, detail: 'exited before readiness' },
    ],
    failures: [
      {
        reason: 'worker 在就绪前退出（code=1, signal=-）',
        service: 'worker',
        exitCode: 1,
      },
    ],
    recentRecords: {
      worker: [
        {
          schema: 'educanvas.log.v1',
          ts: '2026-08-14T11:42:10.218Z',
          level: 'fatal',
          service: 'worker',
          event: 'service.failed',
          message: '启动失败',
          error: {
            name: 'Error',
            code: 'DB_UNREACHABLE',
            message: '数据库无法连接',
          },
        },
      ],
    },
    logDirectory: '/abs/path/tmp/logs/local/local-20260814-112339-a7f2',
    suggestedCommands: ['make status'],
  });
  assert.match(text, /× EduCanvas · Startup failed/);
  assert.match(text, /worker 在就绪前退出/);
  assert.match(text, /DB_UNREACHABLE/);
  assert.match(text, /Recent worker events/);
  // 失败摘要永远显示完整路径，不缩写。
  assert.match(
    text,
    /\/abs\/path\/tmp\/logs\/local\/local-20260814-112339-a7f2/,
  );
  assert.match(text, /Suggested action:/);
  assert.doesNotMatch(text, /\x1b\[/);
});

test('golden: 失败摘要彩色模式仅错误/警告/dim token', () => {
  const text = renderFailureSummary(
    {
      stages: [{ label: 'Worker', ok: false, detail: 'failed' }],
      failures: [{ reason: 'DB_UNREACHABLE' }],
      recentRecords: {},
      logDirectory: '/abs/path/x',
      suggestedCommands: ['make status'],
    },
    { colorEnabled: true },
  );
  assert.match(text, /\x1b\[31m×\x1b\[0m EduCanvas · Startup failed/);
  assert.match(text, /\x1b\[33mError\x1b\[0m/);
  assert.match(text, /\x1b\[33mmake status\x1b\[0m/);
});

test('golden: 状态卡保持历史契约子串', () => {
  const rows = renderStatusCard({
    database: true,
    gateway: false,
    web: true,
    worker: false,
    latest: { state: 'none' },
    dbPort: '5435',
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: false,
  });
  assert.match(rows[0], /Database/);
  assert.match(rows[0], /127\.0\.0\.1:5435/);
  assert.match(rows[1], /Gateway\s+stopped/);
  assert.match(rows[3], /Worker\s+down/);
  assert.match(rows[4], /Runtime\s+none/);
  assert.ok(rows.every((line) => !line.includes('\x1b[')));
});

test('golden: 状态卡全就绪显示 running + pid', () => {
  const rows = renderStatusCard({
    database: true,
    gateway: true,
    web: true,
    worker: true,
    latest: {
      state: 'running',
      runId: 'local-x',
      services: { worker: { pid: 4242 } },
    },
    dbPort: '5434',
    webUrl: 'http://127.0.0.1:3000',
    gatewayUrl: 'http://127.0.0.1:3200',
    colorEnabled: true,
  });
  assert.match(rows[1], /Gateway\s+ready\s+http:\/\/127\.0\.0\.1:3200/);
  assert.match(rows[3], /Worker\s+ready\s+pid=4242/);
  assert.match(rows[4], /Runtime\s+running\s+local-x/);
  assert.match(rows[0], /\x1b\[32m✓\x1b\[0m/);
});

test('golden: renderRecord 字段用 · 分隔、时长人类可读', () => {
  const line = renderRecord({
    ts: '2026-08-14T11:42:10.218Z',
    level: 'info',
    service: 'gateway',
    event: 'route.completed',
    message: '完成',
    method: 'POST',
    route: 'client.turns',
    status: 202,
    durationMs: 8400,
  });
  assert.match(line, /POST · route=client\.turns · status=202 · 8\.40s/);
  assert.doesNotMatch(line, /\x1b\[/);
});

test('golden: renderRecord 错误块用 ↳ 缩进且 error 红色', () => {
  const line = renderRecord(
    {
      ts: '2026-08-14T11:42:10.218Z',
      level: 'error',
      service: 'worker',
      event: 'job.failed',
      message: '处理失败',
      error: { code: 'E_BAD', message: 'boom', retryable: true },
    },
    { color: true },
  );
  assert.match(line, /\x1b\[31m/); // error token 上色
  const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, / ↳ boom · E_BAD · retryable/);
  // 事件名与消息不因着色破坏。
  assert.match(plain, /job\.failed/);
  assert.match(plain, /处理失败/);
});

test('golden: renderRecord maxLineWidth 截断超宽行且无残缺 ANSI', () => {
  const longMessage =
    '用户要求生成一份包含完整课程大纲、学习计划与测评建议的详细中文报告，内容需要覆盖全部章节。';
  const line = renderRecord(
    {
      ts: '2026-08-14T11:42:10.218Z',
      level: 'info',
      service: 'web',
      event: 'service.ready',
      message: longMessage,
    },
    { color: true, maxLineWidth: 40 },
  );
  // 超宽行先剥 ANSI 再截断 → 截断后是纯文本，不含残缺颜色序列。
  assert.ok(line.length < 60);
  assert.doesNotMatch(line, /\x1b\[/);
  assert.ok(line.endsWith('…') || !line.includes(longMessage));
});

test('golden: 无 maxLineWidth 时不截断；显式设置才截断', () => {
  const record = {
    ts: '2026-08-14T11:42:10.218Z',
    level: 'info',
    service: 'gateway',
    event: 'service.ready',
    message: '就绪',
  };
  const unlimited = renderRecord(record, { color: false });
  assert.equal(
    renderRecord(record, { color: false, maxLineWidth: undefined }),
    unlimited,
  );
  assert.equal(
    renderRecord(record, { color: false, maxLineWidth: 120 }),
    unlimited,
  );
  // 40 列 < 渲染宽度 → 截断生效。
  const narrow = renderRecord(record, { color: false, maxLineWidth: 40 });
  assert.notEqual(narrow, unlimited);
  assert.ok(narrow.endsWith('…'));
});

test('golden: 中文宽度不破坏对齐', () => {
  const line = renderSummaryLine(GLYPHS.ok, '迁移', '完成', { color: false });
  // label 定宽 12，中文按 2 格：'迁移' 占 4，补 8 空格。
  assert.equal(line, `${GLYPHS.ok}  ${padDisplay('迁移', 12)} 完成`);
});
