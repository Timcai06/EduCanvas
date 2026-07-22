import { describe, expect, it } from 'vitest';
import {
  MAX_OPERATION_CONTINUATION_RECOVERY_BATCH,
  operationContinuationRecoveryInputSchema,
  operationContinuationRecoveryResultSchema,
} from './operation-continuation-recovery';

describe('Operation continuation recovery contract', () => {
  it('固定受控批次上下限并拒绝额外扫描条件', () => {
    expect(MAX_OPERATION_CONTINUATION_RECOVERY_BATCH).toBe(500);
    expect(
      operationContinuationRecoveryInputSchema.parse({ limit: 1 }),
    ).toEqual({ limit: 1 });
    expect(
      operationContinuationRecoveryInputSchema.parse({
        limit: MAX_OPERATION_CONTINUATION_RECOVERY_BATCH,
      }),
    ).toEqual({ limit: MAX_OPERATION_CONTINUATION_RECOVERY_BATCH });

    for (const input of [
      { limit: 0 },
      { limit: MAX_OPERATION_CONTINUATION_RECOVERY_BATCH + 1 },
      { limit: 1.5 },
      { limit: 1, continuationId: 'continuation:private' },
      { limit: 1, actorId: 'actor:private' },
      { limit: 1, now: '2099-01-01T00:00:00.000Z' },
    ]) {
      expect(
        operationContinuationRecoveryInputSchema.safeParse(input).success,
      ).toBe(false);
    }
  });

  it('结果只接受非负聚合计数且重投数不超过本批检查量', () => {
    expect(
      operationContinuationRecoveryResultSchema.parse({
        examined: 4,
        requeued: 2,
        generationExhausted: 7,
      }),
    ).toEqual({ examined: 4, requeued: 2, generationExhausted: 7 });

    for (const result of [
      { examined: -1, requeued: 0, generationExhausted: 0 },
      { examined: 1, requeued: 1.5, generationExhausted: 0 },
      { examined: 1, requeued: 2, generationExhausted: 0 },
      {
        examined: 1,
        requeued: 1,
        generationExhausted: 0,
        continuationIds: ['continuation:private'],
      },
    ]) {
      expect(
        operationContinuationRecoveryResultSchema.safeParse(result).success,
      ).toBe(false);
    }
  });
});
