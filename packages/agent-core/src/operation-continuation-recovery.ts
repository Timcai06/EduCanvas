import { z } from 'zod';

/** 单次恢复任务允许检查的最大continuation数量，限制数据库与队列压力。 */
export const MAX_OPERATION_CONTINUATION_RECOVERY_BATCH = 500;

/** 仅供可信后台控制面使用；公开调用方不能指定时间、Actor或continuation身份。 */
export const operationContinuationRecoveryInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_OPERATION_CONTINUATION_RECOVERY_BATCH),
  })
  .strict();
export type OperationContinuationRecoveryInput = z.infer<
  typeof operationContinuationRecoveryInputSchema
>;

/**
 * 恢复批次只返回低基数聚合计数，禁止暴露continuation、Operation或Actor身份。
 * generationExhausted是独立backlog观测值，不占本批examined额度；这些项目必须
 * 留给告警与人工处置，不能绕过fencing继续重领。
 */
export const operationContinuationRecoveryResultSchema = z
  .object({
    examined: z.number().int().min(0),
    requeued: z.number().int().min(0),
    generationExhausted: z.number().int().min(0),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.requeued > result.examined) {
      context.addIssue({
        code: 'custom',
        path: ['examined'],
        message: '重新入队数量不能超过本批检查数量',
      });
    }
  });
export type OperationContinuationRecoveryResult = z.infer<
  typeof operationContinuationRecoveryResultSchema
>;

/**
 * 异常退出后的全局恢复控制面。实现必须把过期running扫描与受控重新入队作为
 * 一个原子动作，且只投递稳定continuation引用。该Port不授予执行权：不得修改
 * lifecycle、lease、generation或副作用账本；后续仍须经过正常claim、重新授权和
 * Adapter reconciliation。尤其不得重置或自动重放outcome_unknown副作用。
 */
export interface OperationContinuationRecoveryPort {
  requeueExpiredForExecution(
    input: OperationContinuationRecoveryInput,
  ): Promise<OperationContinuationRecoveryResult>;
}
