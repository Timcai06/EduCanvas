'use client';

import { notebookScopedUrl } from '@/features/workspace/general/notebook-request-context';
import type { InitialChatMessageDTO } from './messages';
import { useAgentTurn, type AgentTurnClientOptions } from './use-teaching-turn';

const TEACHING_TURN_OPTIONS: AgentTurnClientOptions = {
  endpoint: '/api/v1/learn/turn',
  assistantLabel: 'AI 老师',
  cancelEndpoint: (turnId) =>
    `/api/v1/learn/turn/${encodeURIComponent(turnId)}/cancel`,
};

export function useTeachingTurn(
  initialMessages: readonly InitialChatMessageDTO[],
  notebookId?: string,
  conversationId?: string,
) {
  const context =
    notebookId && conversationId ? { notebookId, conversationId } : null;
  return useAgentTurn(
    initialMessages,
    context
      ? {
          ...TEACHING_TURN_OPTIONS,
          endpoint: notebookScopedUrl(TEACHING_TURN_OPTIONS.endpoint, context),
          cancelEndpoint: (turnId) =>
            notebookScopedUrl(
              TEACHING_TURN_OPTIONS.cancelEndpoint!(turnId),
              context,
            ),
        }
      : TEACHING_TURN_OPTIONS,
  );
}
