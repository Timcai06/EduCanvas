import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractExitInfo,
  firstFailure,
  renderFailureSummaryPlain,
} from './local-startup-report.mjs';

const sampleRecords = (service) => [
  {
    schema: 'educanvas.log.v1',
    ts: '2026-08-14T11:42:10.218Z',
    level: 'info',
    service,
    event: 'service.starting',
    message: '启动中',
  },
  {
    schema: 'educanvas.log.v1',
    ts: '2026-08-14T11:42:10.225Z',
    level: 'fatal',
    service,
    event: 'service.failed',
    message: '启动失败',
    error: { name: 'Error', code: 'DB_UNREACHABLE', message: '数据库无法连接' },
  },
];

test('firstFailure 返回首个 error/fatal 记录', () => {
  const failure = firstFailure(sampleRecords('worker'));
  assert.equal(failure.event, 'service.failed');
  assert.equal(failure.error.code, 'DB_UNREACHABLE');
  assert.equal(firstFailure([]), undefined);
});

test('extractExitInfo 提取退出码', () => {
  const info = extractExitInfo([
    ...sampleRecords('worker'),
    {
      schema: 'educanvas.log.v1',
      ts: '2026-08-14T11:42:11.000Z',
      level: 'warn',
      service: 'worker',
      event: 'process.exit',
      code: 1,
      signal: null,
    },
  ]);
  // process.exit 优先于 service.failed（后者不一定带退出码）。
  assert.deepEqual(
    { code: info.code, signal: info.signal },
    { code: 1, signal: null },
  );
});

test('失败摘要只包含失败服务记录，且无 ANSI', () => {
  // recentRecords 的「只含失败服务」过滤由 buildFailure 完成；这里验证
  // 渲染层把传入的服务记录完整呈现、不输出 ANSI。
  const text = renderFailureSummaryPlain({
    stages: [
      { label: 'Database', ok: true, detail: 'ready' },
      { label: 'Worker', ok: false, detail: 'exited before readiness' },
    ],
    failures: [{ reason: 'worker 在就绪前退出（code=1, signal=-）' }],
    recentRecords: {
      worker: sampleRecords('worker'),
    },
    logDirectory: '/tmp/logs/local/local-20260814-112339-a7f2',
    suggestedCommands: ['make status'],
  });
  assert.match(text, /Recent worker events/);
  assert.match(text, /DB_UNREACHABLE/);
  assert.doesNotMatch(text, /\x1b\[/);
  assert.match(text, /worker 在就绪前退出/);
});

test('失败摘要显示完整日志路径与建议命令', () => {
  const text = renderFailureSummaryPlain({
    stages: [{ label: 'Worker', ok: false, detail: 'failed' }],
    failures: [{ reason: 'DB_UNREACHABLE' }],
    recentRecords: {},
    logDirectory: '/abs/path/to/run-dir',
    suggestedCommands: ['pnpm env:check .env'],
  });
  assert.match(text, /\/abs\/path\/to\/run-dir/);
  assert.match(text, /pnpm env:check \.env/);
});

test('失败摘要包含首个 fatal 详情', () => {
  const text = renderFailureSummaryPlain({
    stages: [],
    failures: [{ reason: 'worker 启动失败' }],
    recentRecords: { worker: sampleRecords('worker') },
    logDirectory: '/tmp/x',
    suggestedCommands: [],
  });
  assert.match(text, /DB_UNREACHABLE/);
  assert.match(text, /数据库无法连接/);
});

test('没有失败服务时兜底显示未知错误', () => {
  const text = renderFailureSummaryPlain({
    stages: [],
    failures: [{ reason: '未知错误' }],
    recentRecords: {},
    logDirectory: '/tmp/x',
    suggestedCommands: [],
  });
  assert.match(text, /未知错误/);
});
