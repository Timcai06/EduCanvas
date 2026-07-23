import 'server-only';

import type {
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';
import type {
  TurnApplicationLifecyclePort,
  TurnApplicationLifecycleSnapshot,
} from '@educanvas/agent-runtime';
import {
  DEFAULT_ASSISTANT_LEASE_MS,
  type ChatMessageSnapshot,
  type TeachingApplicationTurnLedgerSnapshot,
} from '@educanvas/db';
import type { AnonymousIdentity } from '../../identity/anonymous-identity';
import { createWebTeachingCitationEvent } from './citations';
import { webTeachingPersistence } from './persistence';

function terminalReplayEvent(
  operationId: string,
  message: ChatMessageSnapshot,
): TurnApplicationEvent {
  if (message.status === 'completed') {
    return {
      protocol: 'educanvas.turn.v2',
      operationId,
      type: 'turn.completed',
      messageId: message.id,
    };
  }
  if (message.status === 'cancelled') {
    return {
      protocol: 'educanvas.turn.v2',
      operationId,
      type: 'turn.cancelled',
      messageId: message.id,
    };
  }
  return {
    protocol: 'educanvas.turn.v2',
    operationId,
    type: 'turn.failed',
    messageId: message.id,
    code:
      message.failureCode === 'POLICY_BLOCKED'
        ? 'POLICY_BLOCKED'
        : 'RUNTIME_FAILED',
    retryable: message.failureCode !== 'POLICY_BLOCKED',
  };
}

/** Web 教学消息生命周期；保持 begin、replay 与 lease 结算的原有顺序。 */
export class WebTeachingLifecycle implements TurnApplicationLifecyclePort {
  private snapshot: TeachingApplicationTurnLedgerSnapshot | null = null;

  constructor(
    private readonly identity: AnonymousIdentity,
    private readonly sessionId: string,
  ) {}

  async begin(
    command: TurnApplicationCommand,
  ): Promise<TurnApplicationLifecycleSnapshot> {
    const snapshot = await webTeachingPersistence.ledger.beginApplicationTurn({
      sessionId: this.sessionId,
      trustedStudentId: this.identity.studentId,
      clientMessageId: command.input.clientMessageId,
      parts: command.input.parts,
      traceId: command.traceId,
      turnId: command.operationId,
      leaseDurationMs: DEFAULT_ASSISTANT_LEASE_MS,
    });
    this.snapshot = snapshot;
    return {
      operationId: snapshot.turn.turnId,
      traceId: command.traceId,
      userMessageId: snapshot.turn.studentMessage.id,
      assistantMessageId: snapshot.turn.assistantMessage.id,
      replayed: snapshot.replayed,
    };
  }

  async replay(): Promise<readonly TurnApplicationEvent[]> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error('web_teaching_turn_snapshot_missing');
    const assistant = snapshot.turn.assistantMessage;
    if (['pending', 'streaming'].includes(assistant.status)) {
      throw new Error('teaching_replay_requires_gateway_event_resume');
    }
    const events: TurnApplicationEvent[] = [];
    if (assistant.content) {
      events.push({
        protocol: 'educanvas.turn.v2',
        operationId: snapshot.turn.turnId,
        type: 'message.delta',
        messageId: assistant.id,
        delta: assistant.content,
      });
    }
    if (assistant.status === 'completed') {
      const citations =
        await webTeachingPersistence.knowledge.listOwnedMessageCitations({
          trustedStudentId: this.identity.studentId,
          sessionId: this.sessionId,
          turnId: snapshot.turn.turnId,
          assistantMessageId: assistant.id,
        });
      events.push(
        ...citations.map((citation) =>
          createWebTeachingCitationEvent(snapshot.turn.turnId, citation),
        ),
      );
    }
    events.push(terminalReplayEvent(snapshot.turn.turnId, assistant));
    return events;
  }

  async settle(
    input: Parameters<TurnApplicationLifecyclePort['settle']>[0],
  ): ReturnType<TurnApplicationLifecyclePort['settle']> {
    const snapshot = this.snapshot;
    const leaseId = snapshot?.leaseId;
    if (!snapshot || !leaseId) {
      throw new Error('web_teaching_turn_lease_missing');
    }
    if (input.content) {
      await webTeachingPersistence.chat.markAssistantStreaming({
        sessionId: this.sessionId,
        trustedStudentId: this.identity.studentId,
        assistantMessageId: input.turn.assistantMessageId,
        leaseId,
      });
      await webTeachingPersistence.chat.appendAssistantDelta({
        sessionId: this.sessionId,
        trustedStudentId: this.identity.studentId,
        assistantMessageId: input.turn.assistantMessageId,
        leaseId,
        delta: input.content,
      });
    }
    await webTeachingPersistence.chat.settleAssistantMessage({
      sessionId: this.sessionId,
      trustedStudentId: this.identity.studentId,
      assistantMessageId: input.turn.assistantMessageId,
      leaseId,
      status: input.status,
      failureCode: input.failureCode,
    });
    return [];
  }
}
