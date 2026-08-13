import type { AgentTurnSendOutcome } from '@/features/chat/turn-send-outcome';

/** 失败、取消、拒绝或中断后保留本轮上下文，供用户原样重试。 */
export function shouldConsumeTurnScopedInputs(
  outcome: AgentTurnSendOutcome,
): boolean {
  return outcome === 'completed';
}
