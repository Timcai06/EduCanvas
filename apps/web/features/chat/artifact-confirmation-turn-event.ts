export class TurnStreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnStreamProtocolError';
  }
}

export interface ArtifactConfirmationRequiredEvent {
  type: 'artifact.confirmation_required';
  schemaVersion: '1';
  turnId: string;
  sequence?: number;
  confirmationId: string;
  kind: ArtifactProposalKind;
  title: string;
}

export function parseArtifactConfirmationEvent(
  parsed: Record<string, unknown>,
): ArtifactConfirmationRequiredEvent {
  const eventName = 'artifact.confirmation_required';
  const kind = artifactProposalKindSchema.safeParse(parsed.kind);
  const id = parsed.confirmationId;
  const title = parsed.title;
  const turnId = parsed.turnId;
  if (parsed.type !== eventName || parsed.schemaVersion !== '1') {
    throw new TurnStreamProtocolError(`${eventName} payload is invalid`);
  }
  if (
    !kind.success ||
    typeof id !== 'string' ||
    !id ||
    id.length > 256 ||
    typeof turnId !== 'string' ||
    !turnId ||
    turnId.length > 256 ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 120
  ) {
    throw new TurnStreamProtocolError(`${eventName} payload is invalid`);
  }
  return {
    type: eventName,
    schemaVersion: '1',
    turnId,
    confirmationId: id,
    kind: kind.data,
    title,
  };
}

export function isKnownTeachingTurnEvent(eventName: string): boolean {
  return (
    eventName === 'artifact.confirmation_required' ||
    new Set([
      'turn.accepted',
      'message.delta',
      'message.citation',
      'turn.completed',
      'turn.failed',
      'turn.cancelled',
      'tool.started',
      'tool.completed',
      'tool.failed',
      'artifact.proposed',
      'artifact.created',
      'artifact.version_added',
      'artifact.generation_progress',
      'artifact.failed',
    ]).has(eventName)
  );
}
import {
  artifactProposalKindSchema,
  type ArtifactProposalKind,
} from '@educanvas/agent-core';
