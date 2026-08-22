/** 浏览器 Turn 的闭合结果；调用方只能在 completed 后消费一次性输入。 */
export type AgentTurnSendOutcome =
  'completed' | 'failed' | 'cancelled' | 'interrupted' | 'rejected';

export interface InFlightTurn {
  clientMessageId: string;
  controller: AbortController;
  turnId: string | null;
  /** Last operation event sequence acknowledged by the browser. */
  nextSequence: number;
  assistantMessageId: string | null;
  terminalReceived: boolean;
  terminalOutcome: Extract<
    AgentTurnSendOutcome,
    'completed' | 'failed' | 'cancelled'
  > | null;
  stopConfirmed: boolean;
  cancelRequested: boolean;
  recoveryAttempted: boolean;
}

export function terminalEventTypeToSendOutcome(
  type: 'turn.completed' | 'turn.failed' | 'turn.cancelled',
): Extract<AgentTurnSendOutcome, 'completed' | 'failed' | 'cancelled'> {
  if (type === 'turn.completed') return 'completed';
  return type === 'turn.failed' ? 'failed' : 'cancelled';
}
