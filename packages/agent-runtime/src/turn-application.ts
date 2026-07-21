import { createHash } from 'node:crypto';
import {
  turnApplicationCommandSchema,
  turnApplicationEventSchema,
  turnApplicationProtocolVersion,
  validateTurnApplicationEventSequence,
  type AgentModelRunLedgerPort,
  type AgentTurnContextLedgerPort,
  type ModelAbortSignal,
  type ModelMessage,
  type ModelToolDefinition,
  type NormalizedModelError,
  type StreamTurnTextRequest,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
  type TurnApplicationFailureCode,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import { AgentLoopEngine } from './agent-loop';
import { buildAgentContext, type ContextSegment } from './context-engine';
import type { ModelRunResult } from './turn-engine';
import {
  ToolKernel,
  type ToolKernelPolicyContext,
  type ToolKernelTrustedContext,
} from './tool-kernel';

/** 三类入口共享的唯一 Turn 应用边界。 */
export interface TurnApplicationPort {
  run(command: TurnApplicationCommand): AsyncIterable<TurnApplicationEvent>;
}

export interface TurnApplicationLifecycleSnapshot {
  operationId: string;
  traceId: string;
  userMessageId: string;
  assistantMessageId: string;
  replayed: boolean;
}

export type TurnApplicationProfileEvent = Extract<
  TurnApplicationEvent,
  {
    type:
      | 'message.citation'
      | 'artifact.proposed'
      | 'artifact.version_added'
      | 'artifact.generation_progress'
      | 'artifact.failed';
  }
>;

/**
 * Operation/Message 的唯一写入边界。实现必须重新验证 Actor、Notebook 与
 * Conversation；Gateway 已存在的 Operation 只能 attach，其他入口只能 create。
 */
export interface TurnApplicationLifecyclePort {
  begin(
    command: TurnApplicationCommand,
  ): Promise<TurnApplicationLifecycleSnapshot>;
  replay(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
  }): Promise<readonly TurnApplicationEvent[]>;
  settle(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
    status: 'completed' | 'failed' | 'cancelled';
    content: string;
    failureCode?: TurnApplicationFailureCode | null;
    citationMarkers?: readonly number[];
  }): Promise<readonly TurnApplicationProfileEvent[]>;
}

/** Segment 与实际 Prompt 消息绑定，防止 Snapshot 选中内容和 Provider 内容漂移。 */
export interface TurnApplicationContextCandidate {
  segment: ContextSegment;
  message: ModelMessage;
  /** synthesis 可使用更严格的系统指令；省略时复用 answer 消息。 */
  synthesisMessage?: ModelMessage;
}

export type TurnApplicationContextMemory =
  | { status: 'unavailable'; reason: 'not_implemented' | 'disabled' }
  | {
      status: 'available';
      version: string;
      candidates: readonly TurnApplicationContextCandidate[];
    };

/** 只包含已由可信仓储完成 Actor/Notebook 过滤的 Context 候选。 */
export interface TurnApplicationContextPlan {
  profileVersion: string;
  profile: readonly TurnApplicationContextCandidate[];
  conversation: readonly TurnApplicationContextCandidate[];
  sourcesAndAssets: readonly TurnApplicationContextCandidate[];
  memory: TurnApplicationContextMemory;
  maxSegments?: number;
  maxCharacters?: number;
}

export interface TurnApplicationToolPolicy extends ToolKernelPolicyContext {
  channel: string;
  environment: string;
  profileContext?: Readonly<Record<string, unknown>>;
  credentialHandle?: string | null;
}

export interface TurnApplicationProfilePlan {
  context: TurnApplicationContextPlan;
  model: {
    modelAlias: 'primary' | 'fast';
    promptVersion: string;
    synthesisPromptVersion?: string;
    maxToolRounds: number;
  };
  /** 省略表示该 Profile 此轮不暴露任何 Tool。 */
  toolPolicy?: TurnApplicationToolPolicy;
}

export interface TurnApplicationProfilePort {
  /** Profile 只装配 Context/Prompt/Policy，不得创建第二个模型循环。 */
  prepare(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
  }): Promise<TurnApplicationProfilePlan>;
  /**
   * 确定性领域服务在消息终态前最后复核答案并提交领域事实；不能返回 Turn 终态。
   */
  finalize?(input: {
    command: TurnApplicationCommand;
    turn: TurnApplicationLifecycleSnapshot;
    content: string;
  }): Promise<{
    content?: string;
    citationMarkers?: readonly number[];
    events?: readonly TurnApplicationProfileEvent[];
  }>;
}

export interface TurnApplicationCancellationHandle {
  signal?: ModelAbortSignal;
  isCancellationRequested(): Promise<boolean>;
  close(): Promise<void> | void;
}

/** M4 可替换为 PostgreSQL lease/heartbeat；当前接口禁止只依赖进程内 AbortController。 */
export interface TurnApplicationCancellationPort {
  open(input: {
    operationId: string;
    actorId: string;
  }): Promise<TurnApplicationCancellationHandle>;
}

export interface TurnApplicationTraceSpan {
  event(name: string, attributes?: Readonly<Record<string, string>>): void;
  end(status: 'completed' | 'failed' | 'cancelled'): void;
}

/** Trace 只接受白名单标识与阶段，不接受正文、Prompt、Tool 参数或 Secret。 */
export interface TurnApplicationTracePort {
  start(input: {
    operationId: string;
    traceId: string;
    actorId: string;
    agentId: string;
    notebookId: string;
    conversationId: string;
    profileId: string;
    entrypoint: TurnApplicationCommand['entrypoint'];
  }): TurnApplicationTraceSpan;
}

const NOOP_TRACE: TurnApplicationTracePort = {
  start() {
    return { event() {}, end() {} };
  },
};

function startTraceSafely(
  port: TurnApplicationTracePort,
  input: Parameters<TurnApplicationTracePort['start']>[0],
): TurnApplicationTraceSpan {
  let span: TurnApplicationTraceSpan;
  try {
    span = port.start(input);
  } catch {
    return NOOP_TRACE.start(input);
  }
  return {
    event(name, attributes) {
      try {
        span.event(name, attributes);
      } catch {
        // 遥测降级不能改变业务终态。
      }
    },
    end(status) {
      try {
        span.end(status);
      } catch {
        // 遥测降级不能改变业务终态。
      }
    },
  };
}

const NOOP_CANCELLATION: TurnApplicationCancellationPort = {
  async open() {
    return {
      async isCancellationRequested() {
        return false;
      },
      close() {},
    };
  },
};

interface ModelRunContext {
  runId: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? '"[undefined]"';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
}

function promptHash(request: StreamTurnTextRequest): string {
  return createHash('sha256')
    .update(
      canonicalize({
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        phase: request.phase,
        promptVersion: request.promptVersion,
        messages: request.messages,
        tools: request.tools,
        toolResults: request.toolResults,
      }),
      'utf8',
    )
    .digest('hex');
}

function providerResult(
  metadata: Extract<ModelRunResult, { ok: true }>['metadata'],
) {
  return {
    provider: metadata.provider,
    providerModelId: metadata.resolvedModelId,
    modelRevision: metadata.modelRevision,
    providerResponseId: metadata.providerResponseId,
    systemFingerprint: metadata.systemFingerprint,
    finishReason: metadata.finishReason,
    latencyMs: metadata.latencyMs,
    usage: metadata.usage,
  };
}

class AuditedModelRunLifecycle {
  private readonly attempts = { answer: 0, synthesis: 0 };

  constructor(
    private readonly ledger: AgentModelRunLedgerPort,
    private readonly input: {
      command: TurnApplicationCommand;
      turn: TurnApplicationLifecycleSnapshot;
      cancellation: TurnApplicationCancellationHandle;
    },
  ) {}

  async start(input: {
    run: number;
    request: StreamTurnTextRequest;
  }): Promise<ModelRunContext> {
    const attempt = ++this.attempts[input.request.phase];
    const created = await this.ledger.createOrGet({
      operationId: this.input.command.operationId,
      actorId: this.input.command.actor.actorId,
      assistantMessageId: this.input.turn.assistantMessageId,
      phase: input.request.phase,
      attempt,
      modelAlias: input.request.modelAlias,
      promptVersion: input.request.promptVersion,
      promptHash: promptHash(input.request),
    });
    // M4 continuation 接入前，绝不对遗留 running Model Run 重放供应商副作用。
    if (created.replayed)
      throw new Error('model_run_replay_requires_continuation');
    const running = await this.ledger.markRunning({
      operationId: this.input.command.operationId,
      actorId: this.input.command.actor.actorId,
      runId: created.run.id,
    });
    if (!running.transitioned) throw new Error('model_run_not_claimed');
    return { runId: running.run.id };
  }

  async settle(input: {
    run: number;
    request: StreamTurnTextRequest;
    context: ModelRunContext;
    outcome: ModelRunResult;
  }): Promise<void> {
    if (input.outcome.ok) {
      await this.ledger.settle({
        operationId: this.input.command.operationId,
        actorId: this.input.command.actor.actorId,
        runId: input.context.runId,
        status: 'succeeded',
        providerResult: providerResult(input.outcome.metadata),
      });
      return;
    }
    const cancellationRequested =
      input.outcome.error.code === 'aborted' &&
      (await this.input.cancellation.isCancellationRequested());
    await this.ledger.settle({
      operationId: this.input.command.operationId,
      actorId: this.input.command.actor.actorId,
      runId: input.context.runId,
      status: cancellationRequested ? 'cancelled' : 'failed',
      errorCode: `model_${input.outcome.error.code}`,
    });
  }
}

function candidates(plan: TurnApplicationContextPlan) {
  return [
    ...plan.profile,
    ...plan.conversation,
    ...plan.sourcesAndAssets,
    ...(plan.memory.status === 'available' ? plan.memory.candidates : []),
  ];
}

function modelMessages(
  selected: readonly ContextSegment[],
  all: readonly TurnApplicationContextCandidate[],
  phase: 'answer' | 'synthesis',
): readonly ModelMessage[] {
  const byId = new Map(
    all.map((candidate) => [candidate.segment.id, candidate]),
  );
  return selected.map((segment) => {
    const candidate = byId.get(segment.id);
    if (
      !candidate ||
      candidate.message.content.trim() !== segment.content.trim() ||
      (segment.kind === 'profile' && candidate.message.role !== 'system') ||
      (segment.kind !== 'profile' && candidate.message.role === 'system') ||
      (candidate.synthesisMessage !== undefined &&
        segment.kind !== 'profile') ||
      (candidate.synthesisMessage !== undefined &&
        candidate.synthesisMessage.role !== 'system')
    ) {
      throw new Error('context_prompt_drift');
    }
    return phase === 'synthesis'
      ? (candidate.synthesisMessage ?? candidate.message)
      : candidate.message;
  });
}

function validCitationMarkers(markers: readonly number[]): boolean {
  return markers.every(
    (marker, index) =>
      Number.isInteger(marker) &&
      marker >= 1 &&
      marker <= 99 &&
      (index === 0 || marker > markers[index - 1]!),
  );
}

function mapModelFailure(error: NormalizedModelError): {
  code: TurnApplicationFailureCode;
  retryable: boolean;
} {
  return {
    code: error.code === 'rate_limit' ? 'RATE_LIMITED' : 'MODEL_FAILED',
    retryable: error.retryable,
  };
}

function mapToolFailure(code: string): TurnApplicationFailureCode {
  if (code === 'approval_required') return 'APPROVAL_REQUIRED';
  if (code.startsWith('capability_denied:')) return 'FORBIDDEN';
  if (code === 'tool_not_available') return 'CAPABILITY_UNAVAILABLE';
  if (code === 'tool_cancelled') return 'CANCELLED';
  return 'TOOL_FAILED';
}

function executionId(
  operationId: string,
  round: number,
  callId: string,
): string {
  return createHash('sha256')
    .update(`${operationId}:${round}:${callId}`, 'utf8')
    .digest('hex');
}

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
          taskAlias: 'agent.turn',
          modelAlias: plan.model.modelAlias,
          promptVersion: plan.model.promptVersion,
          messages: answerMessages,
          tools: toolDefinitions,
        },
        synthesis: {
          taskAlias: 'agent.turn',
          modelAlias: plan.model.modelAlias,
          promptVersion:
            plan.model.synthesisPromptVersion ?? plan.model.promptVersion,
          messages: synthesisMessages,
        },
        maxToolRounds: plan.model.maxToolRounds,
        signal: cancellation.signal,
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
              signal: cancellation.signal,
            });
            if (!executed.ok) {
              return {
                ok: false as const,
                failure: {
                  executionId: id,
                  tool: call.tool,
                  code: mapToolFailure(executed.code),
                  retryable: executed.retryable,
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
          answer += event.event.delta;
          yield {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'message.delta',
            messageId: turn.assistantMessageId,
            delta: event.event.delta,
          };
        } else if (event.type === 'tool.started') {
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
          yield {
            protocol: turnApplicationProtocolVersion,
            operationId: command.operationId,
            type: 'tool.completed',
            toolCallId: event.result.detail.executionId,
          };
        } else if (event.type === 'tool.failed') {
          toolFailure = event.failure;
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

      if (completed && answer.trim()) {
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
      try {
        await cancellation.close();
      } catch {
        // 关闭 watcher/heartbeat 失败由 M4 reconciliation 接管，不能制造第二终态。
      }
    }
  }
}
