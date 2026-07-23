process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import { run } from 'graphile-worker';
import { createContinueOperationTask } from './tasks/continue-operation.js';

const connectionString = process.env.TEST_DATABASE_URL;
const continuationId = process.env.TEST_CONTINUATION_ID;
if (!connectionString || !continuationId) {
  throw new Error('SIGKILL fixture缺少隔离数据库或continuationId');
}

const task = createContinueOperationTask({
  adapters: [
    {
      source: 'node',
      capabilities: ['filesystem.read_allowlisted'],
      async resume() {
        process.send?.({ type: 'adapter_started' });
        return new Promise<never>(() => undefined);
      },
    },
  ],
});

try {
  const runner = await run({
    connectionString,
    concurrency: 1,
    noHandleSignals: true,
    taskList: { [OPERATION_CONTINUATION_TASK]: task },
  });
  await runner.promise;
} catch (error) {
  process.send?.({
    type: 'fixture_failed',
    message: error instanceof Error ? error.message : 'unknown fixture failure',
  });
  process.exitCode = 1;
}
