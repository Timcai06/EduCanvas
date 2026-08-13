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
}

/**
 * 受信 operator 可直接构造的 R05 预览任务；默认 Worker 不注册它，且 payload 没有 apply
 * 能力。写入只能由 operator 边界直接调用 repository.applyPage。日志只记录计数与稳定游标。
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
    const result = await repository.previewPage(input);
    log(`[k12-conversation-backfill] ${JSON.stringify(result)}`);
    if (result.mismatchedBeforeCount > 0) {
      throw new K12ConversationDualWriteInvariantError();
    }
  };
}

export const backfillK12Conversation = createBackfillK12ConversationTask();
