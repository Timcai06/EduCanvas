import type { OperationContinuationSnapshot } from '@educanvas/agent-core';

/** 对不存在与跨Actor访问使用同一错误，避免泄漏continuation身份。 */
export class OperationContinuationOwnershipError extends Error {
  readonly code = 'operation_continuation_not_found';

  constructor() {
    super('Operation continuation不存在或不属于当前Actor');
    this.name = 'OperationContinuationOwnershipError';
  }
}

/** 幂等身份、活动等待点或lease generation冲突。 */
export class OperationContinuationConflictError extends Error {
  readonly code = 'operation_continuation_conflict';

  constructor(message = 'Operation continuation已绑定不同恢复语义') {
    super(message);
    this.name = 'OperationContinuationConflictError';
  }
}

/** 输入或状态迁移违反continuation生命周期不变量。 */
export class OperationContinuationLifecycleError extends Error {
  readonly code = 'invalid_operation_continuation_transition';

  constructor(message: string) {
    super(message);
    this.name = 'OperationContinuationLifecycleError';
  }
}

/** Worker恢复前从当前Operation、Agent、Notebook、Conversation与approval重算的范围。 */
export interface OperationContinuationExecutionScope {
  operationId: string;
  actorId: string;
  agentId: string;
  notebookId: string;
  conversationId: string;
  profileId: string;
  traceId: string;
  capability: string;
  risk: 'l2' | 'l3';
}

/** claimForExecution不会把未通过当前授权检查的工作交给Adapter。 */
export type OperationContinuationExecutionClaim =
  | {
      status: 'claimed';
      continuation: OperationContinuationSnapshot;
      scope: OperationContinuationExecutionScope;
    }
  | { status: 'not_claimed' }
  | {
      status: 'reauthorization_failed';
      operationId: string;
      actorId: string;
    }
  | {
      status: 'cancellation_requested';
      operationId: string;
      actorId: string;
    }
  | { status: 'lease_held'; retryAt: string };
