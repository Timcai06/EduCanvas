import type { ArtifactProposalKind } from '@educanvas/agent-core';
import type { ArtifactConfirmationRequiredEvent } from './artifact-confirmation-turn-event';
import { updateAssistant } from './turn-state-messages';
import type { TeachingTurnState } from './turn-state';

export function applyArtifactConfirmation(
  state: TeachingTurnState,
  assistantId: string,
  event: ArtifactConfirmationRequiredEvent,
): TeachingTurnState {
  return {
    ...state,
    messages: updateAssistant(state.messages, assistantId, (message) => {
      const existing = message.artifactConfirmation;
      if (
        existing?.id === event.confirmationId &&
        existing.status === 'confirmed'
      )
        return message;
      return {
        ...message,
        artifactConfirmation: {
          id: event.confirmationId,
          kind: event.kind as ArtifactProposalKind,
          title: event.title,
          status: 'pending',
        },
      };
    }),
  };
}
