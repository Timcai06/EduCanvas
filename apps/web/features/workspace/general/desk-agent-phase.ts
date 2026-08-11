import type { ChatMessage } from '@/features/chat/messages';

export type DeskAgentPhase = 'quiet' | 'thinking' | 'tool' | 'responding';

export interface DeskAgentPresence {
  readonly phase: DeskAgentPhase;
  readonly toolLabel: string | null;
}

/** 把 Agent 可观察事实投影为案面相位，不从状态文案或模型文本猜测内部过程。 */
export function deriveDeskAgentPresence(
  messages: readonly ChatMessage[],
  busy: boolean,
): DeskAgentPresence {
  if (!busy) return { phase: 'quiet', toolLabel: null };
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  if (latestAssistant?.role === 'assistant') {
    const runningTool = [...(latestAssistant.toolSteps ?? [])]
      .reverse()
      .find((tool) => tool.status === 'running');
    if (runningTool) return { phase: 'tool', toolLabel: runningTool.label };
    if (latestAssistant.text.trim()) {
      return { phase: 'responding', toolLabel: null };
    }
  }
  return { phase: 'thinking', toolLabel: null };
}
