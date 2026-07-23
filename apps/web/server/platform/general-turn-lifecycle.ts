import 'server-only';

import type {
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';
import type {
  TurnApplicationCancellationPort,
  TurnApplicationLifecyclePort,
  TurnApplicationLifecycleSnapshot,
  TurnApplicationProfileEvent,
} from '@educanvas/agent-runtime';
import {
  type PlatformMessageCitationSnapshot,
  type PlatformSettledCitationSnapshot,
  type PlatformTurnSnapshot,
} from '@educanvas/db';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { webGeneralSources, webGeneralTurns } from './general-turn-persistence';

const CANCELLATION_POLL_MS = 250;

function citationEvent(
  operationId: string,
  citation: PlatformMessageCitationSnapshot | PlatformSettledCitationSnapshot,
): TurnApplicationProfileEvent {
  return {
    protocol: 'educanvas.turn.v2',
    operationId,
    type: 'message.citation',
    messageId: citation.assistantMessageId,
    citationId: citation.citationId,
    marker: citation.ordinal,
    label: [...citation.label].slice(0, 160).join(''),
    target: {
      kind: 'web',
      assetId: citation.assetId,
      assetVersionId: citation.assetVersionId,
      url: citation.url,
    },
  };
}

/** Web General消息与引用生命周期；只结算消息，Gateway仍独占Operation终态。 */
export class WebGeneralLifecycle implements TurnApplicationLifecyclePort {
  private snapshot: PlatformTurnSnapshot | null = null;

  constructor(private readonly identity: AnonymousIdentity) {}

  async begin(
    command: TurnApplicationCommand,
  ): Promise<TurnApplicationLifecycleSnapshot> {
    const turn = await webGeneralTurns.attachGatewayTurn({
      operationId: command.operationId,
      conversationId: command.notebook.conversationId,
      trustedSubjectId: this.identity.studentId,
      clientMessageId: command.input.clientMessageId,
      parts: command.input.parts,
    });
    this.snapshot = turn;
    return {
      operationId: turn.turnId,
      traceId: turn.traceId,
      userMessageId: turn.studentMessage.id,
      assistantMessageId: turn.assistantMessage.id,
      replayed: turn.replayed,
    };
  }

  async replay(input: {
    command: TurnApplicationCommand;
  }): Promise<readonly TurnApplicationEvent[]> {
    const turn = this.snapshot;
    if (!turn) throw new Error('web_general_turn_snapshot_missing');
    const events: TurnApplicationEvent[] = [];
    if (turn.assistantMessage.content) {
      events.push({
        protocol: 'educanvas.turn.v2',
        operationId: turn.turnId,
        type: 'message.delta',
        messageId: turn.assistantMessage.id,
        delta: turn.assistantMessage.content,
      });
    }
    const citations = await webGeneralSources.listOwnedMessageCitations({
      conversationId: input.command.notebook.conversationId,
      trustedSubjectId: this.identity.studentId,
      assistantMessageId: turn.assistantMessage.id,
    });
    events.push(
      ...citations.map((citation) => citationEvent(turn.turnId, citation)),
    );
    events.push(
      turn.assistantMessage.status === 'completed'
        ? {
            protocol: 'educanvas.turn.v2',
            operationId: turn.turnId,
            type: 'turn.completed',
            messageId: turn.assistantMessage.id,
          }
        : turn.assistantMessage.status === 'cancelled'
          ? {
              protocol: 'educanvas.turn.v2',
              operationId: turn.turnId,
              type: 'turn.cancelled',
              messageId: turn.assistantMessage.id,
            }
          : {
              protocol: 'educanvas.turn.v2',
              operationId: turn.turnId,
              type: 'turn.failed',
              messageId: turn.assistantMessage.id,
              code: 'RUNTIME_FAILED',
              retryable: true,
            },
    );
    return events;
  }

  async settle(
    input: Parameters<TurnApplicationLifecyclePort['settle']>[0],
  ): ReturnType<TurnApplicationLifecyclePort['settle']> {
    const settled = await webGeneralTurns.settleTurn({
      conversationId: input.command.notebook.conversationId,
      trustedSubjectId: this.identity.studentId,
      turnId: input.command.operationId,
      status: input.status,
      content: input.content,
      failureCode: input.failureCode,
      sourceMarkers: input.citationMarkers,
      operationTerminalWriter: 'gateway',
    });
    return settled.settledCitations.map((citation) =>
      citationEvent(input.command.operationId, citation),
    );
  }
}

/** 合并上游Abort与PostgreSQL取消事实；close必须释放监听器和轮询计时器。 */
export class WebGeneralCancellation implements TurnApplicationCancellationPort {
  constructor(private readonly upstream: ModelAbortSignal) {}

  async open(input: { operationId: string; actorId: string }) {
    const controller = new AbortController();
    let checking = false;
    const abort = () => {
      if (!controller.signal.aborted) controller.abort('turn_cancelled');
    };
    if (this.upstream.aborted) abort();
    else this.upstream.addEventListener('abort', abort, { once: true });
    const timer = setInterval(() => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      void webGeneralTurns
        .isTurnCancellationRequested({
          trustedSubjectId: input.actorId,
          turnId: input.operationId,
        })
        .then((requested) => {
          if (requested) abort();
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }, CANCELLATION_POLL_MS);
    return {
      signal: controller.signal,
      isCancellationRequested: async () =>
        this.upstream.aborted ||
        controller.signal.aborted ||
        (await webGeneralTurns.isTurnCancellationRequested({
          trustedSubjectId: input.actorId,
          turnId: input.operationId,
        })),
      close: () => {
        clearInterval(timer);
        this.upstream.removeEventListener('abort', abort);
      },
    };
  }
}
