import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import { sql } from 'drizzle-orm';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  connectionString,
  database,
} from './approval-continuation.integration-support.js';

export interface GraphileJobRow extends Record<string, unknown> {
  id: string;
  key: string | null;
  payload: unknown;
  lockedAt: string | null;
  lockedBy: string | null;
  attempts: number;
  maxAttempts: number;
}

export function spawnBlockingContinuationWorker(
  continuationId: string,
): ChildProcess {
  return fork(
    fileURLToPath(
      new URL('./approval-continuation-sigkill.fixture.ts', import.meta.url),
    ),
    [],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        TEST_DATABASE_URL: connectionString,
        TEST_CONTINUATION_ID: continuationId,
      },
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
}

export function waitForBlockingAdapter(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderr: Buffer[] = [];
    const timer = setTimeout(
      () =>
        reject(new Error(`子进程Adapter启动超时: ${Buffer.concat(stderr)}`)),
      10_000,
    );
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('message', (message: unknown) => {
      if ((message as { type?: string }).type === 'adapter_started') {
        clearTimeout(timer);
        resolve();
      }
      if ((message as { type?: string }).type === 'fixture_failed') {
        clearTimeout(timer);
        reject(new Error((message as { message: string }).message));
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `子进程在Adapter前退出: code=${code},signal=${signal},stderr=${Buffer.concat(stderr)}`,
        ),
      );
    });
  });
}

export async function listContinuationJobs(): Promise<GraphileJobRow[]> {
  return database.execute<GraphileJobRow>(sql`
    select job.id::text as id, job.key, job.payload,
      job.locked_at as "lockedAt", job.locked_by as "lockedBy",
      job.attempts, job.max_attempts as "maxAttempts"
    from graphile_worker._private_jobs job
    join graphile_worker._private_tasks task on task.id = job.task_id
    where task.identifier = ${OPERATION_CONTINUATION_TASK}
    order by job.id
  `);
}
