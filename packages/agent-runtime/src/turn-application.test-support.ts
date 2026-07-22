import type {
  AgentModelRunLedgerPort,
  AgentModelRunSnapshot,
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  AgentTurnContextLedgerPort,
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  TurnApplicationCommand,
  TurnApplicationEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  TurnApplicationService,
  type TurnApplicationLifecyclePort,
  type TurnApplicationProfileEvent,
  type TurnApplicationProfilePort,
} from './turn-application';

/**
 * TurnApplicationService 单测的共享夹具：固定标识、命令、内存版 Ledger/Profile 与事件收集器。
 * 拆分后的 core/tools/safety/cancellation 各测试文件复用此处，保证被测装配与断言前提完全一致。
 */

export const OPERATION_ID = '00000000-0000-4000-8000-000000000001';
export const AGENT_ID = '00000000-0000-4000-8000-000000000002';
export const NOTEBOOK_ID = '00000000-0000-4000-8000-000000000003';
export const CONVERSATION_ID = '00000000-0000-4000-8000-000000000004';
export const USER_MESSAGE_ID = '00000000-0000-4000-8000-000000000005';
export const ASSISTANT_MESSAGE_ID = '00000000-0000-4000-8000-000000000006';

export const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: OPERATION_ID,
  traceId: 'trace:turn-application',
  actor: { actorId: 'user:owner', agentId: AGENT_ID },
  notebook: {
    notebookId: NOTEBOOK_ID,
    conversationId: CONVERSATION_ID,
  },
  profile: { profileId: 'education.default' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client:message:1',
    parts: [{ type: 'text', text: '你好' }],
  },
  capabilities: ['tool.execute'],
};

export class MemoryLifecycle implements TurnApplicationLifecyclePort {
  readonly settlements: Parameters<
    TurnApplicationLifecyclePort['settle']
  >[0][] = [];

  constructor(
    private readonly replayed = false,
    private readonly replayEvents: readonly TurnApplicationEvent[] = [],
    private readonly settlementEvents: readonly TurnApplicationProfileEvent[] = [],
  ) {}

  async begin() {
    return {
      operationId: OPERATION_ID,
      traceId: command.traceId,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      replayed: this.replayed,
    };
  }

  async replay() {
    return this.replayEvents;
  }

  async settle(input: Parameters<TurnApplicationLifecyclePort['settle']>[0]) {
    this.settlements.push(input);
    return this.settlementEvents;
  }
}

export class MemoryContextLedger implements AgentTurnContextLedgerPort {
  readonly writes: Parameters<AgentTurnContextLedgerPort['createOrGet']>[0][] =
    [];

  async createOrGet(
    input: Parameters<AgentTurnContextLedgerPort['createOrGet']>[0],
  ) {
    this.writes.push(input);
    return {
      snapshot: {
        id: '00000000-0000-4000-8000-000000000007',
        operationId: input.operationId,
        contextHash: 'c'.repeat(64),
        ...input.material,
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      replayed: false,
    };
  }

  async get() {
    return null;
  }
}

export class MemoryModelRunLedger implements AgentModelRunLedgerPort {
  readonly runs: AgentModelRunSnapshot[] = [];
  readonly createInputs: Parameters<
    AgentModelRunLedgerPort['createOrGet']
  >[0][] = [];

  async createOrGet(
    input: Parameters<AgentModelRunLedgerPort['createOrGet']>[0],
  ) {
    this.createInputs.push(input);
    const run: AgentModelRunSnapshot = {
      id: `10000000-0000-4000-8000-${String(this.runs.length + 1).padStart(12, '0')}`,
      operationId: input.operationId,
      assistantMessageId: input.assistantMessageId,
      phase: input.phase,
      attempt: input.attempt ?? 1,
      traceId: command.traceId,
      taskAlias: input.taskAlias,
      modelAlias: input.modelAlias,
      promptVersion: input.promptVersion,
      promptHash: input.promptHash,
      provider: null,
      providerModelId: null,
      modelRevision: null,
      providerResponseId: null,
      systemFingerprint: null,
      finishReason: null,
      status: 'pending',
      errorCode: null,
      inputTokens: null,
      outputTokens: null,
      cacheHitTokens: null,
      reasoningTokens: null,
      latencyMs: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    this.runs.push(run);
    return { run, replayed: false };
  }

  async markRunning(
    input: Parameters<AgentModelRunLedgerPort['markRunning']>[0],
  ) {
    const run = this.runs.find((candidate) => candidate.id === input.runId)!;
    run.status = 'running';
    return { run, transitioned: true };
  }

  async settle(input: Parameters<AgentModelRunLedgerPort['settle']>[0]) {
    const run = this.runs.find((candidate) => candidate.id === input.runId)!;
    run.status = input.status;
    run.errorCode = input.errorCode ?? null;
    run.provider = input.providerResult?.provider ?? run.provider;
    run.providerModelId =
      input.providerResult?.providerModelId ?? run.providerModelId;
    return { run, transitioned: true };
  }

  async listByOperation() {
    return this.runs;
  }
}

export function profile(): TurnApplicationProfilePort {
  return {
    async prepare() {
      return {
        context: {
          profileVersion: 'profile-v1',
          profile: [
            {
              segment: {
                id: 'profile:system',
                kind: 'profile' as const,
                content: '你是诚实的AI老师。',
                priority: 100,
                required: true,
              },
              message: {
                role: 'system' as const,
                content: '你是诚实的AI老师。',
              },
            },
          ],
          conversation: [
            {
              segment: {
                id: 'message:user:current',
                kind: 'conversation' as const,
                content: '你好',
                priority: 90,
                required: true,
                messageId: USER_MESSAGE_ID,
              },
              message: { role: 'user' as const, content: '你好' },
            },
          ],
          sourcesAndAssets: [],
          memory: {
            status: 'unavailable' as const,
            reason: 'not_implemented' as const,
          },
        },
        model: {
          taskAlias: 'agent.turn' as const,
          modelAlias: 'primary' as const,
          promptVersion: 'education-v1',
          maxToolRounds: 2,
        },
      };
    },
  };
}

export function metadata(
  request: Parameters<TurnModelGateway['streamTurnText']>[0],
  finishReason: 'stop' | 'tool_calls',
) {
  return {
    providerResponseId: `response:${request.phase}`,
    provider: 'fixture',
    taskAlias: request.taskAlias,
    modelAlias: request.modelAlias,
    resolvedModelId: 'fixture/model',
    modelRevision: null,
    systemFingerprint: null,
    finishReason,
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    },
    latencyMs: 1,
    traceId: request.traceId,
  } as const;
}

export async function collect(service: TurnApplicationService) {
  const events: TurnApplicationEvent[] = [];
  for await (const event of service.run(command)) events.push(event);
  return events;
}

export class MemoryCallLedger implements AgentToolCallLedgerPort {
  readonly calls: AgentToolCallSnapshot[] = [];

  async createOrGet(
    input: Parameters<AgentToolCallLedgerPort['createOrGet']>[0],
  ) {
    const call: AgentToolCallSnapshot = {
      id: '20000000-0000-4000-8000-000000000001',
      operationId: input.operationId,
      answerModelRunId: input.answerModelRunId,
      providerToolCallId: input.providerToolCallId,
      executionId: input.executionId,
      traceId: command.traceId,
      toolName: input.toolName,
      exposure: input.exposure,
      effect: input.effect,
      argumentSummary: {
        schemaVersion: '1',
        kind: 'object',
        byteLength: 2,
        itemCount: 0,
        sha256: 'a'.repeat(64),
      },
      resultSummary: null,
      status: 'pending',
      code: null,
      retryable: false,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    this.calls.push(call);
    return { call, replayed: false };
  }

  async markRunning(
    input: Parameters<AgentToolCallLedgerPort['markRunning']>[0],
  ) {
    const call = this.calls.find(
      (candidate) => candidate.id === input.toolCallId,
    )!;
    call.status = 'running';
    return { call, transitioned: true };
  }

  async settle(input: Parameters<AgentToolCallLedgerPort['settle']>[0]) {
    const call = this.calls.find(
      (candidate) => candidate.id === input.toolCallId,
    )!;
    call.status = input.status;
    return { call, transitioned: true };
  }

  async listByOperation() {
    return this.calls;
  }
}

export class MemoryEffectLedger implements ToolEffectLedgerPort {
  async intend(input: Parameters<ToolEffectLedgerPort['intend']>[0]) {
    const effect: ToolEffectLedgerSnapshot = {
      id: '30000000-0000-4000-8000-000000000001',
      operationId: input.operationId,
      toolCallId: input.toolCallId,
      effectKey: input.effectKey,
      semanticsHash: input.semanticsHash,
      status: 'intended',
      code: null,
      receiptHash: null,
      intendedAt: '2026-07-21T00:00:00.000Z',
      settledAt: null,
    };
    return { effect, replayed: false };
  }

  async settle(input: Parameters<ToolEffectLedgerPort['settle']>[0]) {
    return {
      effect: {
        id: input.effectId,
        operationId: OPERATION_ID,
        toolCallId: '20000000-0000-4000-8000-000000000001',
        effectKey: 'unused',
        semanticsHash: 'a'.repeat(64),
        status: input.status,
        code: input.code ?? null,
        receiptHash: null,
        intendedAt: '2026-07-21T00:00:00.000Z',
        settledAt: '2026-07-21T00:00:01.000Z',
      },
      transitioned: true,
    };
  }

  async get() {
    return null;
  }
}
