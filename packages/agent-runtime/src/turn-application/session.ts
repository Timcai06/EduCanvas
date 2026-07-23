import {
  turnApplicationEventSchema,
  turnApplicationProtocolVersion,
  validateTurnApplicationEventSequence,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
  type TurnApplicationFailureCode,
} from '@educanvas/agent-core';
import type { TurnApplicationDependencies } from './dependencies';
import type {
  TurnApplicationCancellationHandle,
  TurnApplicationLifecycleSnapshot,
  TurnApplicationTraceSpan,
} from './ports';

/** @internal 跨模块共享的唯一终态写入标记。 */
export interface TurnTerminalState {
  emitted: boolean;
}

/** @internal 校验持久化replay序列；replay不得再次执行Profile、Provider或Tool。 */
export async function loadValidatedReplay(input: {
  dependencies: TurnApplicationDependencies;
  command: TurnApplicationCommand;
  turn: TurnApplicationLifecycleSnapshot;
  started: TurnApplicationEvent;
}): Promise<{
  events: readonly TurnApplicationEvent[];
  status: 'completed' | 'failed' | 'cancelled';
}> {
  const replay = (
    await input.dependencies.lifecycle.replay({
      command: input.command,
      turn: input.turn,
    })
  ).map((event) => turnApplicationEventSchema.parse(event));
  const sequence = [input.started, ...replay];
  if (
    replay.some((event) => event.type === 'turn.started') ||
    !validateTurnApplicationEventSequence(sequence) ||
    !replay.some((event) =>
      ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type),
    )
  ) {
    throw new Error('invalid_turn_replay');
  }
  const terminal = replay.at(-1)!;
  return {
    events: replay,
    status:
      terminal.type === 'turn.completed'
        ? 'completed'
        : terminal.type === 'turn.cancelled'
          ? 'cancelled'
          : 'failed',
  };
}

/** @internal 写入失败或取消唯一终态，并返回对应公开事件。 */
export async function settleTurnFailure(input: {
  dependencies: TurnApplicationDependencies;
  command: TurnApplicationCommand;
  turn: TurnApplicationLifecycleSnapshot;
  cancellation: TurnApplicationCancellationHandle;
  trace: TurnApplicationTraceSpan;
  terminal: TurnTerminalState;
  answer: string;
  code: TurnApplicationFailureCode;
  retryable: boolean;
}): Promise<TurnApplicationEvent> {
  const cancelled =
    input.code === 'CANCELLED' &&
    (await input.cancellation.isCancellationRequested().catch(() => false));
  await input.dependencies.lifecycle.settle({
    command: input.command,
    turn: input.turn,
    status: cancelled ? 'cancelled' : 'failed',
    content: input.answer,
    failureCode: input.code,
  });
  input.terminal.emitted = true;
  input.trace.end(cancelled ? 'cancelled' : 'failed');
  return cancelled
    ? {
        protocol: turnApplicationProtocolVersion,
        operationId: input.command.operationId,
        type: 'turn.cancelled',
        messageId: input.turn.assistantMessageId,
      }
    : {
        protocol: turnApplicationProtocolVersion,
        operationId: input.command.operationId,
        type: 'turn.failed',
        messageId: input.turn.assistantMessageId,
        code: input.code,
        retryable: input.retryable,
      };
}
