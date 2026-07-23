import {
  DrizzleMcpIntentReconciler,
  DrizzleToolApprovalIntentRepository,
  MAX_MCP_INTENT_RECONCILIATION_BATCH,
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
      .max(
        Math.min(
          MAX_TOOL_APPROVAL_INTENT_RECONCILIATION_BATCH,
          MAX_MCP_INTENT_RECONCILIATION_BATCH,
        ),
      )
      .default(100),
    _cron: cronMetadataSchema.optional(),
  })
  .strict();

interface ToolApprovalIntentReconciler {
  abandonExpiredPrepared(input: { limit: number }): Promise<number>;
}

interface McpIntentReconciler {
  abandonExpiredPrepared(input: { limit: number }): Promise<number>;
}

/** 周期收敛Adapter已准备但Gateway未成功公开审批的过期最小意图。 */
export function createReconcileToolApprovalIntentsTask(
  repository: ToolApprovalIntentReconciler = new DrizzleToolApprovalIntentRepository(),
  mcpRepository: McpIntentReconciler = new DrizzleMcpIntentReconciler(),
): Task {
  return async (payload, helpers) => {
    const { limit } = payloadSchema.parse(payload);
    const abandoned = await repository.abandonExpiredPrepared({ limit });
    const mcpAbandoned = await mcpRepository.abandonExpiredPrepared({ limit });
    helpers.logger.info(
      `过期工具审批意图收敛完成,abandoned=${abandoned},mcpAbandoned=${mcpAbandoned},limit=${limit}`,
    );
  };
}

export const reconcileToolApprovalIntents =
  createReconcileToolApprovalIntentsTask();
