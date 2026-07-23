import {
  turnApplicationCommandSchema,
  turnApplicationProtocolVersion,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
  type TurnApplicationFailureCode,
} from '@educanvas/agent-core';
import { completeTurnApplication } from './completion';
import type { TurnApplicationDependencies } from './dependencies';
import {
  mapModelFailure,
  NOOP_CANCELLATION,
  NOOP_TRACE,
  startTraceSafely,
  validPublicDelta,
} from './helpers';
import { runTurnLoop } from './loop-runner';
import type {
  TurnApplicationCancellationHandle,
  TurnApplicationPort,
} from './ports';
import { prepareTurnApplication } from './preparation';
import {
  loadValidatedReplay,
  settleTurnFailure,
  type TurnTerminalState,
} from './session';

/**
 * 第二代唯一Turn应用服务。Transport、Profile、Provider与数据库只通过Port注入；
 * 本类固定启动、准备、Loop、完成与唯一终态的阶段顺序。
 */
export class TurnApplicationService implements TurnApplicationPort {
  constructor(private readonly dependencies: TurnApplicationDependencies) {}

  async *run(
    rawCommand: TurnApplicationCommand,
  ): AsyncGenerator<TurnApplicationEvent> {
    const command = turnApplicationCommandSchema.parse(rawCommand);
    const turn = await this.dependencies.lifecycle.begin(command);
    if (
      turn.operationId !== command.operationId ||
      turn.traceId !== command.traceId
    ) {
      throw new Error('turn_lifecycle_scope_mismatch');
    }
    const started: TurnApplicationEvent = {
      protocol: turnApplicationProtocolVersion,
      operationId: command.operationId,
      type: 'turn.started',
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      replayed: turn.replayed,
    };
    const trace = startTraceSafely(this.dependencies.trace ?? NOOP_TRACE, {
      operationId: command.operationId,
      traceId: command.traceId,
      actorId: command.actor.actorId,
      agentId: command.actor.agentId,
      notebookId: command.notebook.notebookId,
      conversationId: command.notebook.conversationId,
      profileId: command.profile.profileId,
      entrypoint: command.entrypoint,
    });
    yield started;

    if (turn.replayed) {
      let replay;
      try {
        replay = await loadValidatedReplay({
          dependencies: this.dependencies,
          command,
          turn,
          started,
        });
      } catch (error) {
        trace.end('failed');
        throw error;
      }
      for (const event of replay.events) yield event;
      trace.end(replay.status);
      return;
    }

    let cancellation: TurnApplicationCancellationHandle;
    try {
      cancellation = await (
        this.dependencies.cancellation ?? NOOP_CANCELLATION
      ).open({
        operationId: command.operationId,
        actorId: command.actor.actorId,
      });
    } catch {
      await this.dependencies.lifecycle.settle({
        command,
        turn,
        status: 'failed',
        content: '',
        failureCode: 'RUNTIME_FAILED',
      });
      trace.end('failed');
      yield {
        protocol: turnApplicationProtocolVersion,
        operationId: command.operationId,
        type: 'turn.failed',
        messageId: turn.assistantMessageId,
        code: 'RUNTIME_FAILED',
        retryable: true,
      };
      return;
    }

    let answer = '';
    const terminal: TurnTerminalState = { emitted: false };
    const executionController = new AbortController();
    const forwardCancellation = () => {
      if (!executionController.signal.aborted) {
        executionController.abort(cancellation.signal?.reason);
      }
    };
    if (cancellation.signal?.aborted) forwardCancellation();
    else
      cancellation.signal?.addEventListener('abort', forwardCancellation, {
        once: true,
      });
    const emitFailure = (
      code: TurnApplicationFailureCode,
      retryable: boolean,
    ) =>
      settleTurnFailure({
        dependencies: this.dependencies,
        command,
        turn,
        cancellation,
        trace,
        terminal,
        answer,
        code,
        retryable,
      });

    try {
      const preflight = await this.dependencies.profile.preflight?.({
        command,
        turn,
      });
      if (preflight?.kind === 'reject') {
        if (!validPublicDelta(preflight.publicContent)) {
          throw new Error('invalid_profile_preflight_response');
        }
        answer = preflight.publicContent;
        yield {
          protocol: turnApplicationProtocolVersion,
          operationId: command.operationId,
          type: 'message.delta',
          messageId: turn.assistantMessageId,
          delta: preflight.publicContent,
        };
        yield await emitFailure(preflight.failureCode, false);
        return;
      }
      const outputGuard = this.dependencies.profile.createOutputGuard?.({
        command,
        turn,
      });
      trace.event('context.prepare');
      const prepared = await prepareTurnApplication({
        dependencies: this.dependencies,
        command,
        turn,
      });
      const outcome = yield* runTurnLoop({
        dependencies: this.dependencies,
        command,
        turn,
        prepared,
        cancellation,
        controller: executionController,
        traceCarrier: trace.carrier(),
        ...(outputGuard ? { outputGuard } : {}),
      });
      answer = outcome.answer;

      if (outcome.outputBlocked) {
        yield await emitFailure(outcome.outputBlocked, false);
        return;
      }
      if (outcome.outputGuardFailed) {
        yield await emitFailure('RUNTIME_FAILED', true);
        return;
      }
      if (outcome.completed) {
        yield* completeTurnApplication({
          dependencies: this.dependencies,
          command,
          turn,
          cancellation,
          trace,
          terminal,
          answer,
          ...(outputGuard ? { outputGuard } : {}),
        });
        return;
      }
      if (
        (outcome.modelFailure?.code === 'aborted' ||
          outcome.toolFailure?.code === 'CANCELLED') &&
        (await cancellation.isCancellationRequested().catch(() => false))
      ) {
        yield await emitFailure('CANCELLED', false);
        return;
      }
      if (outcome.toolFailure?.approval) {
        trace.event('approval.required', {
          capability: outcome.toolFailure.approval.capability,
          risk: outcome.toolFailure.approval.risk,
        });
        trace.end('suspended');
        yield {
          protocol: turnApplicationProtocolVersion,
          operationId: command.operationId,
          type: 'approval.required',
          approvalId: outcome.toolFailure.approval.approvalId,
          capability: outcome.toolFailure.approval.capability,
          risk: outcome.toolFailure.approval.risk,
          summary: outcome.toolFailure.approval.summary,
          expiresAt: outcome.toolFailure.approval.expiresAt,
        };
        return;
      }
      if (outcome.toolFailure) {
        yield await emitFailure(
          outcome.toolFailure.code,
          outcome.toolFailure.retryable,
        );
        return;
      }
      const mapped = outcome.modelFailure
        ? mapModelFailure(outcome.modelFailure)
        : { code: 'RUNTIME_FAILED' as const, retryable: true };
      yield await emitFailure(mapped.code, mapped.retryable);
    } catch {
      if (!terminal.emitted) {
        yield await emitFailure('RUNTIME_FAILED', true);
      }
    } finally {
      cancellation.signal?.removeEventListener('abort', forwardCancellation);
      try {
        await cancellation.close();
      } catch {
        // watcher/heartbeat关闭失败交给reconciliation，不能制造第二终态。
      }
    }
  }
}
