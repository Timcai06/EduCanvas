/** Continuation恢复队列的低基数健康投影；绝不返回业务身份。 */
export interface OperationContinuationRecoveryHealth {
  ready: number;
  runningActive: number;
  runningExpired: number;
  generationExhausted: number;
  terminalOperationStale: number;
  oldestExpiredAt: string | null;
}

/** Graphile恢复函数未能为已锁业务游标创建可运行successor。 */
export class OperationContinuationRecoveryError extends Error {
  readonly code = 'operation_continuation_recovery_failed';

  constructor(message = 'Operation continuation恢复未能重新入队') {
    super(message);
    this.name = 'OperationContinuationRecoveryError';
  }
}
