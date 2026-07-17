import { quickAddJob, runOnce } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * 覆盖 ADR-0012 的两个核心承诺:
 * 1. 任务即数据库行,worker 消费后完成(库 API 入队);
 * 2. `graphile_worker.add_job()` 是普通 SQL 函数,可以在任意数据库事务内
 *    与业务写入原子提交(SQL 入队)——这是选择 graphile-worker 的决定性理由。
 */
const connectionString = process.env.TEST_DATABASE_URL!;

describe('worker 任务队列回路', () => {
  const pool = new pg.Pool({ connectionString });

  beforeAll(async () => {
    /* 首次 runOnce 触发 graphile-worker 自迁移,建立 graphile_worker schema */
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('库 API 入队的任务被 runOnce 消费且 payload 完整到达', async () => {
    const handler = vi.fn();
    const requestedAt = new Date().toISOString();
    await quickAddJob({ connectionString }, 'system.heartbeat', {
      requestedAt,
    });

    await runOnce({
      connectionString,
      taskList: { 'system.heartbeat': handler },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual({ requestedAt });
  });

  it('SQL add_job 在事务内入队,提交后可被消费;回滚则不产生任务', async () => {
    const handler = vi.fn();

    /* 回滚分支:任务必须随事务消失 */
    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query('begin');
      await rollbackClient.query(
        `select graphile_worker.add_job('system.heartbeat', json_build_object('requestedAt', 'rolled-back'))`,
      );
      await rollbackClient.query('rollback');
    } finally {
      rollbackClient.release();
    }

    /* 提交分支 */
    const commitClient = await pool.connect();
    try {
      await commitClient.query('begin');
      await commitClient.query(
        `select graphile_worker.add_job('system.heartbeat', json_build_object('requestedAt', 'committed'))`,
      );
      await commitClient.query('commit');
    } finally {
      commitClient.release();
    }

    await runOnce({
      connectionString,
      taskList: { 'system.heartbeat': handler },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual({ requestedAt: 'committed' });
  });
});
