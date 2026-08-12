import type { MessageToolStep } from './messages';

interface ToolStepEvent {
  readonly type: 'tool.started' | 'tool.completed' | 'tool.failed';
  readonly toolCallId: string;
  readonly label?: string;
}

/**
 * 将运行时工具事件归并到同一 Assistant 消息的轨迹中。
 *
 * 未见 started 的终态不会伪造工具条目；failed 是该 toolCallId 的不可逆终态，
 * 从而避免迟到 completed 把真实失败覆盖成成功。该函数只更新工具轨迹，不接触
 * Assistant 正文，因此工具前后的 message.delta 继续使用同一文本游标。
 */
export function reconcileToolSteps(
  steps: readonly MessageToolStep[],
  event: ToolStepEvent,
): readonly MessageToolStep[] {
  if (event.type === 'tool.started') {
    if (steps.some((step) => step.id === event.toolCallId)) return steps;
    return [
      ...steps,
      {
        id: event.toolCallId,
        label: event.label ?? '正在使用工具',
        status: 'running',
      },
    ];
  }

  const targetStatus: MessageToolStep['status'] =
    event.type === 'tool.completed' ? 'completed' : 'failed';
  let changed = false;
  const nextSteps = steps.map((step) => {
    if (step.id !== event.toolCallId) return step;
    if (step.status === 'failed' || step.status === targetStatus) return step;
    changed = true;
    return { ...step, status: targetStatus };
  });
  return changed ? nextSteps : steps;
}
