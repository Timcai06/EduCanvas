import assert from 'node:assert/strict';
import test from 'node:test';
import { createE2eWorkerLogAudit } from './e2e-worker-log-audit.mjs';

test('accepts worker output without failed tasks', () => {
  const audit = createE2eWorkerLogAudit();
  audit.ingest('Worker 已启动\nINFO: completed task 7\n');
  assert.doesNotThrow(() => audit.assertClean());
});

test('fails on an unexpected Graphile task error without leaking its stack', () => {
  const audit = createE2eWorkerLogAudit();
  audit.ingest(
    [
      'ERROR: Failed task 29 (assets:render_preview, 4.12ms, attempt 1 of 3) with error:',
      'ObjectStorageError: 对象不存在: private/notebook-source.pdf',
      '    at private/server/path.ts:42:1',
      '',
    ].join('\n'),
  );

  assert.throws(
    () => audit.assertClean(),
    (error) => {
      assert.match(error.message, /assets:render_preview attempt 1\/3/);
      assert.doesNotMatch(error.message, /private|ObjectStorageError|path\.ts/);
      return true;
    },
  );
});

test('handles a failed-task line split across stream chunks', () => {
  const audit = createE2eWorkerLogAudit();
  audit.ingest('ERROR: Failed task 3 (assets:trans');
  audit.ingest('cribe_audio, 8ms, attempt 2 of 3)\n');
  assert.throws(() => audit.assertClean(), /assets:transcribe_audio/);
});

test('permits only explicitly allowlisted task identifiers', () => {
  const audit = createE2eWorkerLogAudit({
    allowedTaskIdentifiers: ['test:intentional_failure'],
  });
  audit.ingest(
    'ERROR: Failed task 9 (test:intentional_failure, 1ms, attempt 1 of 1)\n',
  );
  assert.doesNotThrow(() => audit.assertClean());
});
