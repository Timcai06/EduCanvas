import type {
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';
import type {
  TurnApplicationCancellationPort,
  TurnApplicationLifecyclePort,
  TurnApplicationLifecycleSnapshot,
} from '@educanvas/agent-runtime';
import { toGatewayFailureCode } from '@educanvas/gateway-runtime';
import {
  DrizzlePlatformTurnRepository,
  type PlatformTurnSnapshot,
} from '@educanvas/db';

/** Gateway Turn对持久消息账本所需的最小边界。 */
export interface GatewayTurnRepositoryPort {
  attachGatewayTurn(
    input: Parameters<DrizzlePlatformTurnRepository['attachGatewayTurn']>[0],
  ): Promise<PlatformTurnSnapshot>;
  settleTurn(
    input: Parameters<DrizzlePlatformTurnRepository['settleTurn']>[0],
  ): Promise<PlatformTurnSnapshot>;
  listMessages(
    input: Parameters<DrizzlePlatformTurnRepository['listMessages']>[0],
  ): ReturnType<DrizzlePlatformTurnRepository['listMessages']>;
  isTurnCancellationRequested(
    input: Parameters<
      DrizzlePlatformTurnRepository['isTurnCancellationRequested']
    >[0],
  ): Promise<boolean>;
}

/** Gateway消息生命周期Adapter；Operation终态仍由Gateway事件循环唯一写入。 */
export class GatewayTurnLifecycle implements TurnApplicationLifecyclePort {
  private snapshot: PlatformTurnSnapshot | null = null;

  constructor(private readonly turns: GatewayTurnRepositoryPort) {}

  async begin(
    command: TurnApplicationCommand,
  ): Promise<TurnApplicationLifecycleSnapshot> {
    const turn = await this.turns.attachGatewayTurn({
      operationId: command.operationId,
      conversationId: command.notebook.conversationId,
      trustedSubjectId: command.actor.actorId,
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

  async replay(): Promise<readonly TurnApplicationEvent[]> {
    const turn = this.snapshot;
    if (!turn) throw new Error('gateway_turn_snapshot_missing');
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
    if (
      input.status === 'failed' &&
      (input.failureCode === null ||
        input.failureCode === undefined ||
        input.retryable === undefined)
    ) {
      throw new Error('gateway_failure_intent_missing');
    }
    const gatewayTerminalIntent =
      input.status === 'completed'
        ? {
            status: 'completed' as const,
            messageId: input.turn.assistantMessageId,
          }
        : input.status === 'cancelled'
          ? { status: 'cancelled' as const }
          : {
              status: 'failed' as const,
              code: toGatewayFailureCode(input.failureCode!),
              retryable: input.retryable!,
            };
    await this.turns.settleTurn({
      conversationId: input.command.notebook.conversationId,
      trustedSubjectId: input.command.actor.actorId,
      turnId: input.command.operationId,
      status: input.status,
      content: input.content,
      failureCode: input.failureCode,
      sourceMarkers: input.citationMarkers,
      operationTerminalWriter: 'gateway',
      gatewayTerminalIntent,
    });
    return [];
  }
}

/** 把当前Gateway请求信号与PostgreSQL取消事实合并为单一取消句柄。 */
export class GatewayBoundCancellation implements TurnApplicationCancellationPort {
  constructor(
    private readonly signal: ModelAbortSignal,
    private readonly turns: GatewayTurnRepositoryPort,
  ) {}

  async open(input: { operationId: string; actorId: string }) {
    return {
      signal: this.signal,
      isCancellationRequested: () =>
        this.turns.isTurnCancellationRequested({
          trustedSubjectId: input.actorId,
          turnId: input.operationId,
        }),
      close() {},
    };
  }
}
