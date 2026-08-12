import type { GatewayFailureCode } from '@educanvas/gateway-core';

/** Gateway 对外可观察的唯一 Operation 终态，不包含任何正文或内部异常。 */
export type GatewayTerminalIntent =
  | { status: 'completed'; messageId: string }
  | {
      status: 'failed';
      code: GatewayFailureCode;
      retryable: boolean;
    }
  | { status: 'cancelled' };

/**
 * assistant 正文/引用结算事务同时冻结的最小 terminal commit intent。
 * 它不保存正文，只保留 Gateway 重放唯一终态所需的公开字段。
 */
export interface GatewayTerminalCommitIntent {
  protocol: 'educanvas.gateway-terminal.v1';
  operationId: string;
  assistantMessageId: string;
  terminal: GatewayTerminalIntent;
  settledAt: string;
}

/**
 * Terminal reconciliation 只读取持久事实。Adapter 必须在同一可信范围内加载
 * assistant、Operation 和 terminal event，且不得把 Provider body、Prompt 或 stack
 * 放入 intent。
 */
export interface GatewayTerminalConsistencySnapshot {
  operationId: string;
  settlementIntent: GatewayTerminalIntent | null;
  operationStatus: 'running' | 'completed' | 'failed' | 'cancelled';
  terminalEvent: GatewayTerminalIntent | null;
}

export type GatewayTerminalReconciliationDecision =
  | { action: 'pending' }
  | { action: 'consistent'; terminal: GatewayTerminalIntent }
  | { action: 'append_operation_terminal'; terminal: GatewayTerminalIntent }
  | { action: 'settle_assistant'; terminal: GatewayTerminalIntent }
  | {
      action: 'conflict';
      reason:
        | 'operation_terminal_without_event'
        | 'terminal_event_without_operation_terminal'
        | 'operation_event_status_mismatch'
        | 'assistant_operation_terminal_mismatch';
    };

function terminalStatus(
  intent: GatewayTerminalIntent,
): Exclude<GatewayTerminalConsistencySnapshot['operationStatus'], 'running'> {
  return intent.status;
}

function sameTerminal(
  left: GatewayTerminalIntent,
  right: GatewayTerminalIntent,
): boolean {
  if (left.status !== right.status) return false;
  switch (left.status) {
    case 'completed':
      return right.status === 'completed' && left.messageId === right.messageId;
    case 'failed':
      return (
        right.status === 'failed' &&
        left.code === right.code &&
        left.retryable === right.retryable
      );
    case 'cancelled':
      return true;
  }
}

/**
 * 冻结 CA01 的最小 reconciliation 状态机。
 *
 * - 两侧都未终结时不制造终态；
 * - 只有一侧存在终态时补齐另一侧；
 * - 已有事实冲突时停止，禁止最后写入者覆盖；
 * - 调用者必须以 Operation 级事务锁重复执行该决定，模型和工具不参与重放。
 */
export function decideGatewayTerminalReconciliation(
  snapshot: GatewayTerminalConsistencySnapshot,
): GatewayTerminalReconciliationDecision {
  const operationTerminal = snapshot.operationStatus !== 'running';
  if (operationTerminal && snapshot.terminalEvent === null) {
    return { action: 'conflict', reason: 'operation_terminal_without_event' };
  }
  if (!operationTerminal && snapshot.terminalEvent !== null) {
    return {
      action: 'conflict',
      reason: 'terminal_event_without_operation_terminal',
    };
  }
  if (
    snapshot.terminalEvent !== null &&
    terminalStatus(snapshot.terminalEvent) !== snapshot.operationStatus
  ) {
    return { action: 'conflict', reason: 'operation_event_status_mismatch' };
  }
  if (snapshot.settlementIntent === null && snapshot.terminalEvent === null) {
    return { action: 'pending' };
  }
  if (snapshot.settlementIntent !== null && snapshot.terminalEvent === null) {
    return {
      action: 'append_operation_terminal',
      terminal: snapshot.settlementIntent,
    };
  }
  if (snapshot.settlementIntent === null && snapshot.terminalEvent !== null) {
    return {
      action: 'settle_assistant',
      terminal: snapshot.terminalEvent,
    };
  }
  if (
    snapshot.settlementIntent !== null &&
    snapshot.terminalEvent !== null &&
    sameTerminal(snapshot.settlementIntent, snapshot.terminalEvent)
  ) {
    return { action: 'consistent', terminal: snapshot.terminalEvent };
  }
  return {
    action: 'conflict',
    reason: 'assistant_operation_terminal_mismatch',
  };
}

/** Operation 级幂等键只用于日志/诊断，不包含消息正文或失败详情。 */
export function gatewayTerminalReconciliationKey(operationId: string): string {
  return `gateway-terminal-reconciliation-v1:${operationId}`;
}
