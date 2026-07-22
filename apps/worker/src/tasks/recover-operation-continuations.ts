import {
  MAX_OPERATION_CONTINUATION_RECOVERY_BATCH,
  operationContinuationRecoveryInputSchema,
  operationContinuationRecoveryResultSchema,
} from '@educanvas/agent-core';
import { DrizzleOperationContinuationRecoveryRepository } from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

const cronMetadataSchema = z
  .object({
    ts: z.string().min(1),
    backfilled: z.boolean().optional(),
  })
  .strict();

const payloadSchema = operationContinuationRecoveryInputSchema.extend({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_OPERATION_CONTINUATION_RECOVERY_BATCH)
    .default(100),
  _cron: cronMetadataSchema.optional(),
});

const recoveryHealthSchema = z
  .object({
    ready: z.number().int().min(0),
    runningActive: z.number().int().min(0),
    runningExpired: z.number().int().min(0),
    generationExhausted: z.number().int().min(0),
    terminalOperationStale: z.number().int().min(0),
    oldestExpiredAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

interface ContinuationRecoveryRepository {
  requeueExpiredForExecution(input: { limit: number }): Promise<unknown>;
  inspectRecoveryHealth(): Promise<unknown>;
}

/**
 * 收敛业务lease已过期但仍被Graphile长锁占用的continuation。
 * 日志只包含低基数计数与时间，不输出任何Operation、Actor或continuation身份。
 */
export function createRecoverOperationContinuationsTask(
  repository: ContinuationRecoveryRepository = new DrizzleOperationContinuationRecoveryRepository(),
): Task {
  return async (payload, helpers) => {
    const { limit } = payloadSchema.parse(payload);
    const result = operationContinuationRecoveryResultSchema.parse(
      await repository.requeueExpiredForExecution({ limit }),
    );
    const health = recoveryHealthSchema.parse(
      await repository.inspectRecoveryHealth(),
    );
    helpers.logger.info(
      `continuation恢复完成,examined=${result.examined},requeued=${result.requeued},generationExhausted=${result.generationExhausted},ready=${health.ready},runningActive=${health.runningActive},runningExpired=${health.runningExpired},terminalOperationStale=${health.terminalOperationStale},oldestExpiredAt=${health.oldestExpiredAt ?? 'none'},limit=${limit}`,
    );
  };
}

export const recoverOperationContinuations =
  createRecoverOperationContinuationsTask();
