import {
  MAX_OPERATION_CONTINUATION_RECOVERY_BATCH,
  OPERATION_CONTINUATION_TASK,
  operationContinuationRecoveryInputSchema,
  operationContinuationRecoveryResultSchema,
  type OperationContinuationRecoveryPort,
} from '@educanvas/agent-core';
import { sql } from 'drizzle-orm';
import { getDb } from '../client';
import type { ContinuationDatabase } from './persistence';
import {
  OperationContinuationRecoveryError,
  type OperationContinuationRecoveryHealth,
} from './recovery-contracts';

const MAX_LEASE_GENERATION = 1_000_000;
const GRAPHILE_MAX_ATTEMPTS = 25;

interface RequeuedRow extends Record<string, unknown> {
  continuationId: string;
  jobId: string | null;
}

interface CountRow extends Record<string, unknown> {
  count: number;
}

interface HealthRow extends Record<string, unknown> {
  ready: number;
  runningActive: number;
  runningExpired: number;
  generationExhausted: number;
  terminalOperationStale: number;
  oldestExpiredAt: Date | string | null;
}

function toIsoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new OperationContinuationRecoveryError('恢复健康时间无效');
  }
  return timestamp.toISOString();
}

/**
 * 业务lease到期后的Graphile恢复控制面。扫描与add_job同事务提交；不修改
 * continuation lifecycle、owner、expiry、heartbeat或generation。
 */
export class DrizzleOperationContinuationRecoveryRepository implements OperationContinuationRecoveryPort {
  constructor(private readonly providedDatabase?: ContinuationDatabase) {}

  private get database(): ContinuationDatabase {
    return this.providedDatabase ?? getDb();
  }

  async requeueExpiredForExecution(rawInput: { limit: number; now?: Date }) {
    const input = operationContinuationRecoveryInputSchema.parse({
      limit: rawInput.limit,
    });
    const now = rawInput.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.execute<RequeuedRow>(sql`
        with candidates as materialized (
          select continuation.id
          from operation_continuations continuation
          inner join agent_operations operation
            on operation.id = continuation.operation_id
          where continuation.status = 'running'
            and continuation.lease_expires_at <= ${now.toISOString()}::timestamptz
            and continuation.lease_generation < ${MAX_LEASE_GENERATION}
            and operation.status = 'running'
          order by continuation.lease_expires_at,
            continuation.updated_at, continuation.id
          for update of continuation skip locked
          limit ${input.limit}
        )
        select candidate.id::text as "continuationId",
          (graphile_worker.add_job(
            identifier => ${OPERATION_CONTINUATION_TASK},
            payload => json_build_object('continuationId', candidate.id),
            run_at => ${now.toISOString()}::timestamptz,
            max_attempts => ${GRAPHILE_MAX_ATTEMPTS},
            job_key => 'operation-continuation:' || candidate.id::text,
            job_key_mode => 'replace'
          )).id::text as "jobId"
        from candidates candidate
      `);
      if (rows.some((row) => !row.jobId)) {
        throw new OperationContinuationRecoveryError();
      }
      const [exhausted] = await transaction.execute<CountRow>(sql`
        select count(*)::int as count
        from operation_continuations continuation
        inner join agent_operations operation
          on operation.id = continuation.operation_id
        where continuation.status = 'running'
          and continuation.lease_expires_at <= ${now.toISOString()}::timestamptz
          and continuation.lease_generation >= ${MAX_LEASE_GENERATION}
          and operation.status = 'running'
      `);
      return operationContinuationRecoveryResultSchema.parse({
        examined: rows.length,
        requeued: rows.length,
        generationExhausted: exhausted?.count ?? 0,
      });
    });
  }

  /** 返回全局低基数恢复健康投影；不得据此暴露单条业务身份。 */
  async inspectRecoveryHealth(
    input: { now?: Date } = {},
  ): Promise<OperationContinuationRecoveryHealth> {
    const now = input.now ?? new Date();
    const [row] = await this.database.execute<HealthRow>(sql`
      select
        count(*) filter (where continuation.status = 'ready')::int as ready,
        count(*) filter (
          where continuation.status = 'running'
            and continuation.lease_expires_at > ${now.toISOString()}::timestamptz
            and operation.status = 'running'
        )::int as "runningActive",
        count(*) filter (
          where continuation.status = 'running'
            and continuation.lease_expires_at <= ${now.toISOString()}::timestamptz
            and operation.status = 'running'
        )::int as "runningExpired",
        count(*) filter (
          where continuation.status = 'running'
            and continuation.lease_expires_at <= ${now.toISOString()}::timestamptz
            and continuation.lease_generation >= ${MAX_LEASE_GENERATION}
            and operation.status = 'running'
        )::int as "generationExhausted",
        count(*) filter (
          where continuation.status in ('waiting_approval', 'ready', 'running')
            and operation.status <> 'running'
        )::int as "terminalOperationStale",
        min(continuation.lease_expires_at) filter (
          where continuation.status = 'running'
            and continuation.lease_expires_at <= ${now.toISOString()}::timestamptz
            and operation.status = 'running'
        ) as "oldestExpiredAt"
      from operation_continuations continuation
      inner join agent_operations operation
        on operation.id = continuation.operation_id
    `);
    if (!row) throw new OperationContinuationRecoveryError('恢复健康查询失败');
    return {
      ready: row.ready,
      runningActive: row.runningActive,
      runningExpired: row.runningExpired,
      generationExhausted: row.generationExhausted,
      terminalOperationStale: row.terminalOperationStale,
      oldestExpiredAt: toIsoTimestamp(row.oldestExpiredAt),
    };
  }
}

export { MAX_OPERATION_CONTINUATION_RECOVERY_BATCH };
