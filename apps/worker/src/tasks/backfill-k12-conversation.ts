import {
  DrizzleK12ConversationBackfillRepository,
  K12ConversationDualWriteInvariantError,
  type K12ConversationBackfillInput,
  type K12ConversationBackfillResult,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

export const K12_CONVERSATION_BACKFILL_TASK =
  'maintenance:backfill_k12_conversation';

const payloadSchema = z
  .object({
    mode: z.enum(['dry-run', 'apply']).default('dry-run'),
    limit: z.number().int().min(1).max(500).default(100),
    after: z
      .object({
        createdAt: z.string().datetime({ offset: true }),
        messageId: z.string().uuid(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export interface K12ConversationBackfillPort {
  previewPage(
    input: K12ConversationBackfillInput,
  ): Promise<K12ConversationBackfillResult>;
  applyPage(
    input: K12ConversationBackfillInput,
  ): Promise<K12ConversationBackfillResult>;
}

/**
 * 手工触发的 R05 回填任务；未加入 crontab，避免未经批准自动修改历史数据。
 * payload 默认 dry-run，apply 必须显式声明。日志只记录计数与稳定游标。
 */
export function createBackfillK12ConversationTask(
  repository: K12ConversationBackfillPort = new DrizzleK12ConversationBackfillRepository(),
  log: (message: string) => void = console.log,
): Task {
  return async (rawPayload) => {
    const parsed = payloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      throw new K12ConversationDualWriteInvariantError();
    }
    const input: K12ConversationBackfillInput = {
      limit: parsed.data.limit,
      after: parsed.data.after ?? null,
    };
    const result =
      parsed.data.mode === 'apply'
        ? await repository.applyPage(input)
        : await repository.previewPage(input);
    log(`[k12-conversation-backfill] ${JSON.stringify(result)}`);
    if (result.mismatchedBeforeCount > 0) {
      throw new K12ConversationDualWriteInvariantError();
    }
  };
}

export const backfillK12Conversation = createBackfillK12ConversationTask();
