import {
  DrizzleToolApprovalIntentRepository,
  MAX_TOOL_APPROVAL_INTENT_RECONCILIATION_BATCH,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

const cronMetadataSchema = z
  .object({
    ts: z.string().min(1),
    backfilled: z.boolean().optional(),
  })
  .strict();

const payloadSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOOL_APPROVAL_INTENT_RECONCILIATION_BATCH)
      .default(100),
    _cron: cronMetadataSchema.optional(),
  })
  .strict();

interface ToolApprovalIntentReconciler {
  abandonExpiredPrepared(input: { limit: number }): Promise<number>;
}

/** 周期收敛Adapter已准备但Gateway未成功公开审批的过期最小意图。 */
export function createReconcileToolApprovalIntentsTask(
  repository: ToolApprovalIntentReconciler = new DrizzleToolApprovalIntentRepository(),
): Task {
  return async (payload, helpers) => {
    const { limit } = payloadSchema.parse(payload);
    const abandoned = await repository.abandonExpiredPrepared({ limit });
    helpers.logger.info(
      `过期工具审批意图收敛完成,abandoned=${abandoned},limit=${limit}`,
    );
  };
}

export const reconcileToolApprovalIntents =
  createReconcileToolApprovalIntentsTask();
