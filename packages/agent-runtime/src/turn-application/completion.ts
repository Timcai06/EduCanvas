import {
  turnApplicationEventSchema,
  turnApplicationProtocolVersion,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
} from '@educanvas/agent-core';
import type { TurnApplicationDependencies } from './dependencies';
import {
  validCitationMarkers,
  validGuardDeltas,
  validPublicDelta,
} from './helpers';
import type {
  TurnApplicationCancellationHandle,
  TurnApplicationLifecycleSnapshot,
  TurnApplicationOutputGuardPort,
  TurnApplicationTraceSpan,
} from './ports';
import { settleTurnFailure, type TurnTerminalState } from './session';

/** @internal 完成Output Guard、Profile领域提交、Lifecycle结算与公开完成终态。 */
export async function* completeTurnApplication(input: {
  dependencies: TurnApplicationDependencies;
  command: TurnApplicationCommand;
  turn: TurnApplicationLifecycleSnapshot;
  cancellation: TurnApplicationCancellationHandle;
  trace: TurnApplicationTraceSpan;
  terminal: TurnTerminalState;
  answer: string;
  outputGuard?: TurnApplicationOutputGuardPort;
}): AsyncGenerator<TurnApplicationEvent> {
  let answer = input.answer;
  if (input.outputGuard) {
    const guarded = await input.outputGuard.finish();
    if (guarded.kind === 'block') {
      if (!validPublicDelta(guarded.publicContent)) {
        throw new Error('invalid_profile_output_block_response');
      }
      const publicDelta = `${answer ? '\n\n' : ''}${guarded.publicContent}`;
      if (!validPublicDelta(publicDelta)) {
        throw new Error('invalid_profile_output_block_response');
      }
      answer += publicDelta;
      yield {
        protocol: turnApplicationProtocolVersion,
        operationId: input.command.operationId,
        type: 'message.delta',
        messageId: input.turn.assistantMessageId,
        delta: publicDelta,
      };
      yield await settleTurnFailure({
        dependencies: input.dependencies,
        command: input.command,
        turn: input.turn,
        cancellation: input.cancellation,
        trace: input.trace,
        terminal: input.terminal,
        answer,
        code: guarded.failureCode,
        retryable: false,
      });
      return;
    }
    if (!validGuardDeltas(guarded.safeDeltas, true)) {
      throw new Error('invalid_profile_output_deltas');
    }
    for (const delta of guarded.safeDeltas) {
      answer += delta;
      yield {
        protocol: turnApplicationProtocolVersion,
        operationId: input.command.operationId,
        type: 'message.delta',
        messageId: input.turn.assistantMessageId,
        delta,
      };
    }
  }
  if (!answer.trim()) throw new Error('profile_removed_entire_answer');
  const finalized = await input.dependencies.profile.finalize?.({
    command: input.command,
    turn: input.turn,
    content: answer,
  });
  answer = finalized?.content ?? answer;
  if (!answer.trim()) throw new Error('profile_removed_entire_answer');
  const markers = finalized?.citationMarkers ?? [];
  if (!validCitationMarkers(markers)) {
    throw new Error('invalid_profile_citation_markers');
  }
  const profileEvents = (finalized?.events ?? []).map((event) =>
    turnApplicationEventSchema.parse(event),
  );
  if (
    profileEvents.some(
      (event) => event.operationId !== input.command.operationId,
    )
  ) {
    throw new Error('profile_event_scope_mismatch');
  }
  const settlementEvents = await input.dependencies.lifecycle.settle({
    command: input.command,
    turn: input.turn,
    status: 'completed',
    content: answer,
    citationMarkers: markers,
  });
  input.terminal.emitted = true;
  for (const event of profileEvents) yield event;
  for (const event of settlementEvents) {
    const parsed = turnApplicationEventSchema.safeParse(event);
    if (
      parsed.success &&
      parsed.data.operationId === input.command.operationId
    ) {
      yield parsed.data;
    } else {
      input.trace.event('lifecycle.event.invalid');
    }
  }
  input.trace.end('completed');
  yield {
    protocol: turnApplicationProtocolVersion,
    operationId: input.command.operationId,
    type: 'turn.completed',
    messageId: input.turn.assistantMessageId,
  };
}
