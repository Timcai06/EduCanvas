import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@/features/chat/messages';
import { deriveDeskAgentPresence } from './desk-agent-phase';

function assistant(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: 'a1',
    turnId: 't1',
    clientMessageId: 'c1',
    role: 'assistant',
    status: 'streaming',
    text: '',
    attachments: [],
    ...overrides,
  };
}

describe('deriveDeskAgentPresence', () => {
  it('安静、思考、工具与回答四相位由可观察事件确定', () => {
    expect(deriveDeskAgentPresence([], false).phase).toBe('quiet');
    expect(deriveDeskAgentPresence([], true).phase).toBe('thinking');
    expect(
      deriveDeskAgentPresence(
        [
          assistant({
            toolSteps: [{ id: 'x', label: '知识检索', status: 'running' }],
          }),
        ],
        true,
      ),
    ).toEqual({ phase: 'tool', toolLabel: '知识检索' });
    expect(
      deriveDeskAgentPresence([assistant({ text: '正在落笔' })], true).phase,
    ).toBe('responding');
  });
});
