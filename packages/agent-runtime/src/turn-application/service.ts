import {
  turnApplicationCommandSchema,
  turnApplicationEventSchema,
  turnApplicationProtocolVersion,
  validateTurnApplicationEventSequence,
  type AgentModelRunLedgerPort,
  type AgentTurnContextLedgerPort,
  type ModelToolDefinition,
  type NormalizedModelError,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
  type TurnApplicationFailureCode,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import { AgentLoopEngine } from '../agent-loop';
import { buildAgentContext } from '../context-engine';
import { ToolKernel, type ToolKernelTrustedContext } from '../tool-kernel';
import {
  AuditedModelRunLifecycle,
  type ModelRunContext,
} from './model-run-lifecycle';
import {
  candidates,
  executionId,
  mapModelFailure,
  mapToolFailure,
  modelMessages,
  NOOP_CANCELLATION,
  NOOP_TRACE,
  startTraceSafely,
  validCitationMarkers,
  validGuardDeltas,
  validPublicDelta,
} from './helpers';
import type {
  TurnApplicationCancellationHandle,
  TurnApplicationCancellationPort,
  TurnApplicationLifecyclePort,
  TurnApplicationOutputGuardPushResult,
  TurnApplicationPort,
  TurnApplicationProfilePort,
  TurnApplicationTracePort,
} from './ports';

/**
 * 第二代唯一 Turn 应用服务。Transport、Profile、Provider 与数据库都通过 Port
 * 注入；本类独占 Context -> Model -> Tool -> Domain -> 终态的编排顺序。
 */
export class TurnApplicationService implements TurnApplicationPort {
  constructor(
    private readonly dependencies: {
      lifecycle: TurnApplicationLifecyclePort;
      profile: TurnApplicationProfilePort;
      contextLedger: AgentTurnContextLedgerPort;
      modelRunLedger: AgentModelRunLedgerPort;
      modelGateway: TurnModelGateway;
      toolKernel?: ToolKernel;
      cancellation?: TurnApplicationCancellationPort;
      trace?: TurnApplicationTracePort;
    },
  ) {}

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
      const replay = (
        await this.dependencies.lifecycle.replay({ command, turn })
      ).map((event) => turnApplicationEventSchema.parse(event));
      const sequence = [started, ...replay];
      if (
        replay.some((event) => event.type === 'turn.started') ||
        !validateTurnApplicationEventSequence(sequence) ||
        !replay.some((event) =>
          ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(
            event.type,
          ),
        )
      ) {
        trace.end('failed');
        throw new Error('invalid_turn_replay');
      }
      for (const event of replay) yield event;
      const terminal = replay.at(-1)!;
      trace.end(
        terminal.type === 'turn.completed'
          ? 'completed'
          : terminal.type === 'turn.cancelled'
            ? 'cancelled'
            : 'failed',
      );
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
    let terminalEmitted = false;
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
    const emitFailure = async (
      code: TurnApplicationFailureCode,
      retryable: boolean,
    ): Promise<TurnApplicationEvent> => {
      const cancelled =
        code === 'CANCELLED' &&
        (await cancellation.isCancellationRequested().catch(() => false));
      await this.dependencies.lifecycle.settle({
        command,
        turn,
        status: cancelled ? 'cancelled' : 'failed',
        content: answer,
        failureCode: code,
      });
      terminalEmitted = true;
      trace.end(cancelled ? 'cancelled' : 'failed');
      return cancelled
        ? {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'turn.cancelled',
            messageId: turn.assistantMessageId,
          }
        : {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'turn.failed',
            messageId: turn.assistantMessageId,
            code,
            retryable,
          };
    };

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
      let outputBlocked: TurnApplicationFailureCode | null = null;
      let outputGuardFailed = false;
      trace.event('context.prepare');
      const plan = await this.dependencies.profile.prepare({ command, turn });
      const allCandidates = candidates(plan.context);
      const built = buildAgentContext({
        profileVersion: plan.context.profileVersion,
        profile: plan.context.profile.map((candidate) => candidate.segment),
        conversation: plan.context.conversation.map(
          (candidate) => candidate.segment,
        ),
        sourcesAndAssets: plan.context.sourcesAndAssets.map(
          (candidate) => candidate.segment,
        ),
        memory:
          plan.context.memory.status === 'available'
            ? {
                status: 'available',
                version: plan.context.memory.version,
                segments: plan.context.memory.candidates.map(
                  (candidate) => candidate.segment,
                ),
              }
            : plan.context.memory,
        maxSegments: plan.context.maxSegments,
        maxCharacters: plan.context.maxCharacters,
      });
      const contextSnapshot = await this.dependencies.contextLedger.createOrGet(
        {
          operationId: command.operationId,
          actorId: command.actor.actorId,
          material: built.material,
        },
      );
      if (contextSnapshot.replayed) {
        throw new Error('context_replay_requires_continuation');
      }
      const answerMessages = modelMessages(
        built.segments,
        allCandidates,
        'answer',
      );
      const synthesisMessages = modelMessages(
        built.segments,
        allCandidates,
        'synthesis',
      );
      if (
        !built.material.includedMessageIds.includes(turn.userMessageId) ||
        !answerMessages.some((message) => message.role === 'system') ||
        !answerMessages.some((message) => message.role === 'user') ||
        !Number.isSafeInteger(plan.model.maxToolRounds) ||
        plan.model.maxToolRounds < 1 ||
        plan.model.maxToolRounds > 4 ||
        !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(plan.model.promptVersion) ||
        (plan.model.synthesisPromptVersion !== undefined &&
          !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(
            plan.model.synthesisPromptVersion,
          ))
      ) {
        throw new Error('invalid_profile_plan');
      }
      const policy = plan.toolPolicy;
      const toolKernel = this.dependencies.toolKernel;
      const toolDefinitions: readonly ModelToolDefinition[] =
        toolKernel && policy ? toolKernel.listDefinitions(policy) : [];
      const modelLifecycle = new AuditedModelRunLifecycle(
        this.dependencies.modelRunLedger,
        { command, turn, cancellation },
      );
      type ToolDetail = { executionId: string };
      type ToolFailure = {
        executionId: string;
        tool: string;
        code: TurnApplicationFailureCode;
        retryable: boolean;
        approval?: {
          approvalId: string;
          capability: string;
          risk: 'l2' | 'l3';
          summary: string;
          expiresAt: string;
        };
      };
      const callIds = new Map<string, string>();
      let completed = false;
      let modelFailure: NormalizedModelError | null = null;
      let toolFailure: ToolFailure | null = null;
      const loop = new AgentLoopEngine(this.dependencies.modelGateway);
      for await (const event of loop.stream<
        ToolDetail,
        ToolFailure,
        ModelRunContext
      >({
        traceId: command.traceId,
        turnId: command.operationId,
        answer: {
          taskAlias: plan.model.taskAlias,
          modelAlias: plan.model.modelAlias,
          promptVersion: plan.model.promptVersion,
          messages: answerMessages,
          tools: toolDefinitions,
        },
        synthesis: {
          taskAlias: plan.model.taskAlias,
          modelAlias: plan.model.modelAlias,
          promptVersion:
            plan.model.synthesisPromptVersion ?? plan.model.promptVersion,
          messages: synthesisMessages,
        },
        maxToolRounds: plan.model.maxToolRounds,
        signal: executionController.signal,
        modelRunLifecycle: modelLifecycle,
        async executeTools(calls, context) {
          if (!context.modelRun || !policy || !toolKernel) {
            const call = calls[0]!;
            return {
              ok: false as const,
              failure: {
                executionId:
                  callIds.get(`${context.round}:${call.callId}`) ??
                  command.operationId,
                tool: call.tool,
                code: 'CAPABILITY_UNAVAILABLE' as const,
                retryable: false,
              },
            };
          }
          const results = [];
          for (const call of calls) {
            const id = callIds.get(`${context.round}:${call.callId}`);
            if (!id) {
              return {
                ok: false as const,
                failure: {
                  executionId: command.operationId,
                  tool: call.tool,
                  code: 'RUNTIME_FAILED' as const,
                  retryable: false,
                },
              };
            }
            const trusted: ToolKernelTrustedContext = {
              operationId: command.operationId,
              conversationId: command.notebook.conversationId,
              traceId: command.traceId,
              actorId: command.actor.actorId,
              agentId: command.actor.agentId,
              notebookId: command.notebook.notebookId,
              profileId: command.profile.profileId,
              channel: policy.channel,
              environment: policy.environment,
              answerModelRunId: context.modelRun.runId,
              providerToolCallId: call.callId,
              executionId: id,
              capabilities: policy.capabilities,
              approvedCapabilities: policy.approvedCapabilities,
              profileContext: policy.profileContext,
              credentialHandle: policy.credentialHandle,
            };
            const executed = await toolKernel.execute({
              tool: call.tool,
              arguments: call.arguments,
              context: trusted,
              signal: executionController.signal,
            });
            if (!executed.ok) {
              return {
                ok: false as const,
                failure: {
                  executionId: id,
                  tool: call.tool,
                  code: mapToolFailure(executed.code),
                  retryable: executed.retryable,
                  ...(executed.status === 'approval_required'
                    ? {
                        approval: {
                          approvalId: executed.approval.approvalId,
                          capability: executed.approval.capability,
                          risk: executed.approval.risk,
                          summary: executed.approval.summary,
                          expiresAt: executed.approval.expiresAt,
                        },
                      }
                    : {}),
                },
              };
            }
            results.push({
              call,
              modelResult: {
                callId: call.callId,
                tool: call.tool,
                arguments: call.arguments,
                output: executed.output,
              },
              detail: { executionId: id },
            });
          }
          return { ok: true as const, results };
        },
      })) {
        if (event.type === 'model' && event.event.type === 'text_delta') {
          if (outputBlocked || outputGuardFailed) continue;
          let guarded: TurnApplicationOutputGuardPushResult;
          try {
            guarded = outputGuard
              ? await outputGuard.push(event.event.delta)
              : {
                  kind: 'emit',
                  safeDeltas: [event.event.delta],
                };
          } catch {
            outputGuardFailed = true;
            executionController.abort('profile_output_guard_failed');
            continue;
          }
          if (guarded.kind === 'hold') continue;
          if (guarded.kind === 'block') {
            if (!validPublicDelta(guarded.publicContent)) {
              outputGuardFailed = true;
              executionController.abort('profile_output_guard_failed');
              continue;
            }
            const publicDelta = `${answer ? '\n\n' : ''}${guarded.publicContent}`;
            if (!validPublicDelta(publicDelta)) {
              outputGuardFailed = true;
              executionController.abort('profile_output_guard_failed');
              continue;
            }
            answer += publicDelta;
            outputBlocked = guarded.failureCode;
            executionController.abort('profile_output_blocked');
            yield {
              protocol: turnApplicationProtocolVersion,
              operationId: command.operationId,
              type: 'message.delta',
              messageId: turn.assistantMessageId,
              delta: publicDelta,
            };
            continue;
          }
          if (!validGuardDeltas(guarded.safeDeltas)) {
            outputGuardFailed = true;
            executionController.abort('profile_output_guard_failed');
            continue;
          }
          for (const delta of guarded.safeDeltas) {
            answer += delta;
            yield {
              protocol: turnApplicationProtocolVersion,
              operationId: command.operationId,
              type: 'message.delta',
              messageId: turn.assistantMessageId,
              delta,
            };
          }
        } else if (event.type === 'tool.started') {
          if (outputBlocked || outputGuardFailed) continue;
          const id = executionId(
            command.operationId,
            event.run,
            event.call.callId,
          );
          callIds.set(`${event.run}:${event.call.callId}`, id);
          yield {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'tool.started',
            toolCallId: id,
            tool: toolKernel?.capabilityFor(event.call.tool) ?? 'tool.unknown',
          };
        } else if (event.type === 'tool.result') {
          if (outputBlocked || outputGuardFailed) continue;
          yield {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'tool.completed',
            toolCallId: event.result.detail.executionId,
          };
        } else if (event.type === 'tool.failed') {
          if (outputBlocked || outputGuardFailed) continue;
          toolFailure = event.failure;
          if (event.failure.approval) continue;
          yield {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'tool.failed',
            toolCallId: event.failure.executionId,
            code: event.failure.code,
            retryable: event.failure.retryable,
          };
        } else if (event.type === 'failed') {
          modelFailure = event.error;
        } else if (event.type === 'completed') {
          completed = true;
        }
      }

      if (outputBlocked) {
        yield await emitFailure(outputBlocked, false);
        return;
      }
      if (outputGuardFailed) {
        yield await emitFailure('RUNTIME_FAILED', true);
        return;
      }

      if (completed) {
        if (outputGuard) {
          const guarded = await outputGuard.finish();
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
              operationId: command.operationId,
              type: 'message.delta',
              messageId: turn.assistantMessageId,
              delta: publicDelta,
            };
            yield await emitFailure(guarded.failureCode, false);
            return;
          }
          if (!validGuardDeltas(guarded.safeDeltas, true)) {
            throw new Error('invalid_profile_output_deltas');
          }
          for (const delta of guarded.safeDeltas) {
            answer += delta;
            yield {
              protocol: turnApplicationProtocolVersion,
              operationId: command.operationId,
              type: 'message.delta',
              messageId: turn.assistantMessageId,
              delta,
            };
          }
        }
        if (!answer.trim()) throw new Error('profile_removed_entire_answer');
        const finalized = await this.dependencies.profile.finalize?.({
          command,
          turn,
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
            (event) => event.operationId !== command.operationId,
          )
        ) {
          throw new Error('profile_event_scope_mismatch');
        }
        const settlementEvents = await this.dependencies.lifecycle.settle({
          command,
          turn,
          status: 'completed',
          content: answer,
          citationMarkers: markers,
        });
        terminalEmitted = true;
        for (const event of profileEvents) yield event;
        for (const event of settlementEvents) {
          const parsed = turnApplicationEventSchema.safeParse(event);
          if (
            parsed.success &&
            parsed.data.operationId === command.operationId
          ) {
            yield parsed.data;
          } else {
            trace.event('lifecycle.event.invalid');
          }
        }
        trace.end('completed');
        yield {
          protocol: turnApplicationProtocolVersion,
          operationId: command.operationId,
          type: 'turn.completed',
          messageId: turn.assistantMessageId,
        };
        return;
      }

      if (
        (modelFailure?.code === 'aborted' ||
          toolFailure?.code === 'CANCELLED') &&
        (await cancellation.isCancellationRequested().catch(() => false))
      ) {
        yield await emitFailure('CANCELLED', false);
        return;
      }
      if (toolFailure?.approval) {
        trace.event('approval.required', {
          capability: toolFailure.approval.capability,
          risk: toolFailure.approval.risk,
        });
        trace.end('suspended');
        yield {
          protocol: turnApplicationProtocolVersion,
          operationId: command.operationId,
          type: 'approval.required',
          approvalId: toolFailure.approval.approvalId,
          capability: toolFailure.approval.capability,
          risk: toolFailure.approval.risk,
          summary: toolFailure.approval.summary,
          expiresAt: toolFailure.approval.expiresAt,
        };
        return;
      }
      if (toolFailure) {
        yield await emitFailure(toolFailure.code, toolFailure.retryable);
        return;
      }
      const mapped = modelFailure
        ? mapModelFailure(modelFailure)
        : { code: 'RUNTIME_FAILED' as const, retryable: true };
      yield await emitFailure(mapped.code, mapped.retryable);
    } catch {
      if (!terminalEmitted) {
        yield await emitFailure('RUNTIME_FAILED', true);
      }
    } finally {
      cancellation.signal?.removeEventListener('abort', forwardCancellation);
      try {
        await cancellation.close();
      } catch {
        // 关闭 watcher/heartbeat 失败由 M4 reconciliation 接管，不能制造第二终态。
      }
    }
  }
}
