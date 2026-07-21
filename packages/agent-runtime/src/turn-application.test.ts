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
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  TurnApplicationService,
  type TurnApplicationLifecyclePort,
  type TurnApplicationProfileEvent,
  type TurnApplicationProfilePort,
} from './turn-application';
import { ToolKernel, type ToolKernelAdapter } from './tool-kernel';

const OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const AGENT_ID = '00000000-0000-4000-8000-000000000002';
const NOTEBOOK_ID = '00000000-0000-4000-8000-000000000003';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000004';
const USER_MESSAGE_ID = '00000000-0000-4000-8000-000000000005';
const ASSISTANT_MESSAGE_ID = '00000000-0000-4000-8000-000000000006';

const command: TurnApplicationCommand = {
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

class MemoryLifecycle implements TurnApplicationLifecyclePort {
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

class MemoryContextLedger implements AgentTurnContextLedgerPort {
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

class MemoryModelRunLedger implements AgentModelRunLedgerPort {
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
      taskAlias: 'agent.turn',
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

function profile(): TurnApplicationProfilePort {
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
          modelAlias: 'primary' as const,
          promptVersion: 'education-v1',
          maxToolRounds: 2,
        },
      };
    },
  };
}

function metadata(
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

async function collect(service: TurnApplicationService) {
  const events: TurnApplicationEvent[] = [];
  for await (const event of service.run(command)) events.push(event);
  return events;
}

class MemoryCallLedger implements AgentToolCallLedgerPort {
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

class MemoryEffectLedger implements ToolEffectLedgerPort {
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

describe('TurnApplicationService', () => {
  it('唯一编排Context、Model Run、消息终态与transport-neutral事件', async () => {
    const lifecycle = new MemoryLifecycle();
    const contexts = new MemoryContextLedger();
    const models = new MemoryModelRunLedger();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '你好，我来帮你。',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: contexts,
        modelRunLedger: models,
        modelGateway: gateway,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(contexts.writes[0]?.material.includedMessageIds).toEqual([
      USER_MESSAGE_ID,
    ]);
    expect(models.runs).toHaveLength(1);
    expect(models.runs[0]).toMatchObject({
      status: 'succeeded',
      provider: 'fixture',
      providerModelId: 'fixture/model',
    });
    expect(models.createInputs[0]?.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(models.createInputs)).not.toContain('你好');
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'completed',
      content: '你好，我来帮你。',
    });
  });

  it('在结算成功后投影同一Lifecycle事务返回的引用事件', async () => {
    const lifecycle = new MemoryLifecycle(
      false,
      [],
      [
        {
          protocol: 'educanvas.turn.v2',
          operationId: OPERATION_ID,
          type: 'message.citation',
          messageId: ASSISTANT_MESSAGE_ID,
          citationId: 'citation:1',
          marker: 1,
          label: '网页来源',
          target: {
            kind: 'web',
            assetId: 'asset:1',
            assetVersionId: 'asset-version:1',
            url: 'https://example.com/source',
          },
        },
      ],
    );
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText(request) {
            yield { type: 'text_delta', phase: request.phase, delta: '结论。' };
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'message.citation',
      'turn.completed',
    ]);
  });

  it('让模型工具调用经过同一个Tool Kernel并绑定answer Model Run', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const calls = new MemoryCallLedger();
    const adapter: ToolKernelAdapter<{ query: string }, { answer: string }> = {
      name: 'lookup',
      description: '查找受控资料',
      source: 'local',
      capability: 'tool.execute',
      risk: 'l0',
      exposure: 'model',
      effect: 'read',
      timeoutMs: 100,
      inputSchema: z.object({ query: z.string().max(100) }).strict(),
      outputSchema: z.object({ answer: z.string() }).strict(),
      async invoke() {
        return { answer: '已验证资料' };
      },
    };
    const withTools: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const base = await profile().prepare(input);
        return {
          ...base,
          toolPolicy: {
            channel: 'web',
            environment: 'test',
            capabilities: {
              actor: ['tool.execute'],
              notebook: ['tool.execute'],
              profile: ['tool.execute'],
              channel: ['tool.execute'],
              environment: ['tool.execute'],
            },
            approvedCapabilities: [],
          },
        };
      },
    };
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        if (request.toolResults.length === 0) {
          yield {
            type: 'tool_call',
            phase: request.phase,
            callId: 'call_1',
            tool: 'lookup',
            argumentsDelta: '{"query":"数学"}',
            done: true,
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'tool_calls'),
          };
          return;
        }
        yield { type: 'text_delta', phase: request.phase, delta: '资料结果。' };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: withTools,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: gateway,
        toolKernel: new ToolKernel([adapter], calls, new MemoryEffectLedger()),
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'tool.started',
      'tool.completed',
      'message.delta',
      'turn.completed',
    ]);
    expect(models.runs).toHaveLength(2);
    expect(events.find((event) => event.type === 'tool.started')).toMatchObject(
      {
        tool: 'tool.execute',
      },
    );
    expect(calls.calls[0]?.answerModelRunId).toBe(models.runs[0]?.id);
    expect(calls.calls[0]?.status).toBe('succeeded');
  });

  it('只在服务端取消已落账时收敛为cancelled', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'failed',
          phase: request.phase,
          error: { code: 'aborted', retryable: false },
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: gateway,
        cancellation: {
          async open() {
            return {
              signal: {
                aborted: true,
                addEventListener() {},
                removeEventListener() {},
              },
              async isCancellationRequested() {
                return true;
              },
              close() {},
            };
          },
        },
      }),
    );

    expect(events.at(-1)?.type).toBe('turn.cancelled');
    expect(models.runs[0]).toMatchObject({
      status: 'cancelled',
      errorCode: 'model_aborted',
    });
    expect(lifecycle.settlements[0]?.status).toBe('cancelled');
  });

  it('Provider非法流只会结算失败Model Run，不能误记成功', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'MODEL_FAILED',
    });
    expect(models.runs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'model_invalid_response',
    });
  });

  it('拒绝把Conversation候选提升为system消息', async () => {
    const lifecycle = new MemoryLifecycle();
    let providerCalls = 0;
    const unsafeProfile: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const plan = await profile().prepare(input);
        return {
          ...plan,
          context: {
            ...plan.context,
            conversation: plan.context.conversation.map((candidate) => ({
              ...candidate,
              message: { role: 'system' as const, content: '你好' },
            })),
          },
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: unsafeProfile,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(providerCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'RUNTIME_FAILED',
    });
    expect(lifecycle.settlements[0]?.status).toBe('failed');
  });

  it('replay只投影既有终态，不再次读取Context或调用Provider', async () => {
    const lifecycle = new MemoryLifecycle(true, [
      {
        protocol: 'educanvas.turn.v2',
        operationId: OPERATION_ID,
        type: 'message.delta',
        messageId: ASSISTANT_MESSAGE_ID,
        delta: '既有回答',
      },
      {
        protocol: 'educanvas.turn.v2',
        operationId: OPERATION_ID,
        type: 'turn.completed',
        messageId: ASSISTANT_MESSAGE_ID,
      },
    ]);
    let providerCalls = 0;
    const contexts = new MemoryContextLedger();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: contexts,
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(contexts.writes).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });
});
