import type { TurnResult } from '../../shared/turn-result';

export interface BubblePresentation {
  text: string;
  status: 'completed' | 'failed';
}

export function turnResultToBubble(
  result: TurnResult,
): BubblePresentation | null {
  if (result.ok) return { text: result.message, status: 'completed' };
  if (result.code === 'aborted') return null; // 用户取消不报错
  return { text: result.message, status: 'failed' };
}
