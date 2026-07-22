import type {
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
} from '@educanvas/agent-core';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  ToolKernel,
  toolPolicyDimensions,
  type ToolKernelAdapter,
  type ToolKernelTrustedContext,
  type ToolSource,
} from './tool-kernel';

class MemoryCallLedger implements AgentToolCallLedgerPort {
  readonly calls = new Map<string, AgentToolCallSnapshot>();

  async createOrGet(
    input: Parameters<AgentToolCallLedgerPort['createOrGet']>[0],
  ) {
    const existing = this.calls.get(input.executionId);
    if (existing) return { call: existing, replayed: true };
    const call: AgentToolCallSnapshot = {
      id: `00000000-0000-4000-8000-${String(this.calls.size + 1).padStart(12, '0')}`,
      operationId: input.operationId,
      answerModelRunId: input.answerModelRunId,
      providerToolCallId: input.providerToolCallId,
      executionId: input.executionId,
      traceId: 'trace:test',
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
    this.calls.set(input.executionId, call);
    return { call, replayed: false };
  }

  async markRunning(
    input: Parameters<AgentToolCallLedgerPort['markRunning']>[0],
  ) {
    const call = [...this.calls.values()].find(
      (candidate) => candidate.id === input.toolCallId,
    )!;
    call.status = 'running';
    return { call, transitioned: true };
  }

  async settle(input: Parameters<AgentToolCallLedgerPort['settle']>[0]) {
    const call = [...this.calls.values()].find(
      (candidate) => candidate.id === input.toolCallId,
    )!;
    call.status = input.status;
    call.code = input.code ?? null;
    return { call, transitioned: true };
  }

  async listByOperation() {
    return [...this.calls.values()];
  }
}

class MemoryEffectLedger implements ToolEffectLedgerPort {
  readonly effects = new Map<string, ToolEffectLedgerSnapshot>();

  async intend(input: Parameters<ToolEffectLedgerPort['intend']>[0]) {
    const existing = this.effects.get(input.effectKey);
    if (existing) return { effect: existing, replayed: true };
    const effect: ToolEffectLedgerSnapshot = {
      id: `10000000-0000-4000-8000-${String(this.effects.size + 1).padStart(12, '0')}`,
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
    this.effects.set(input.effectKey, effect);
    return { effect, replayed: false };
  }

  async settle(input: Parameters<ToolEffectLedgerPort['settle']>[0]) {
    const effect = [...this.effects.values()].find(
      (candidate) => candidate.id === input.effectId,
    )!;
    effect.status = input.status;
    effect.code = input.code ?? null;
    return { effect, transitioned: true };
  }

  async get(input: Parameters<ToolEffectLedgerPort['get']>[0]) {
    return this.effects.get(input.effectKey) ?? null;
  }
}

function context(
  suffix: string,
  capability = 'tool.execute',
): ToolKernelTrustedContext {
  return {
    operationId: '20000000-0000-4000-8000-000000000001',
    conversationId: '20000000-0000-4000-8000-000000000005',
    traceId: `trace:${suffix}`,
    actorId: 'user:tool-owner',
    agentId: '20000000-0000-4000-8000-000000000002',
    notebookId: '20000000-0000-4000-8000-000000000003',
    profileId: 'education.default',
    channel: 'web',
    environment: 'test',
    answerModelRunId: '20000000-0000-4000-8000-000000000004',
    providerToolCallId: `call-${suffix}`,
    executionId: `execution-${suffix}`,
    capabilities: {
      actor: [capability],
      notebook: [capability],
      profile: [capability],
      channel: [capability],
      environment: [capability],
    },
    approvedCapabilities: [],
  };
}

function adapter(
  input: {
    source?: ToolSource;
    risk?: 'l0' | 'l2';
    effect?: 'read' | 'write';
    timeoutMs?: number;
    modelInputSchema?: Readonly<Record<string, unknown>>;
    invoke?: ToolKernelAdapter<{ value: string }, { source: string }>['invoke'];
    prepareApproval?: ToolKernelAdapter<
      { value: string },
      { source: string }
    >['prepareApproval'];
  } = {},
): ToolKernelAdapter<{ value: string }, { source: string }> {
  const source = input.source ?? 'local';
  return {
    name: `run${source[0]!.toUpperCase()}${source.slice(1)}`,
    description: `运行${source}`,
    source,
    capability: 'tool.execute',
    risk: input.risk ?? 'l0',
    exposure: 'model',
    effect: input.effect ?? 'read',
    timeoutMs: input.timeoutMs ?? 100,
    inputSchema: z.object({ value: z.string().max(100) }).strict(),
    ...(input.modelInputSchema
      ? { modelInputSchema: input.modelInputSchema }
      : {}),
    outputSchema: z.object({ source: z.string() }).strict(),
    ...(input.prepareApproval
      ? { prepareApproval: input.prepareApproval }
      : {}),
    invoke:
      input.invoke ??
      (async () => {
        return { source };
      }),
  };
}

describe('生产Tool Kernel', () => {
  it('模型可见Schema可由可信Adapter投影且不替代本地执行校验', async () => {
    const modelInputSchema = {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 20 } },
      required: ['query'],
      additionalProperties: false,
    } as const;
    const kernel = new ToolKernel(
      [adapter({ modelInputSchema })],
      new MemoryCallLedger(),
      new MemoryEffectLedger(),
    );

    expect(
      kernel.listDefinitions({
        capabilities: {
          actor: ['tool.execute'],
          notebook: ['tool.execute'],
          profile: ['tool.execute'],
          channel: ['tool.execute'],
          environment: ['tool.execute'],
        },
        approvedCapabilities: [],
      }),
    ).toEqual([expect.objectContaining({ inputSchema: modelInputSchema })]);
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { query: 'remote-only' },
        context: context('local-validation'),
      }),
    ).resolves.toMatchObject({
      status: 'denied',
      code: 'invalid_arguments',
    });
  });

  it('四类Adapter共享同一权限、Schema和执行内核', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const sources = ['local', 'teaching', 'mcp', 'node'] as const;
    const kernel = new ToolKernel(
      sources.map((source) => adapter({ source })),
      calls,
      effects,
    );
    for (const source of sources) {
      await expect(
        kernel.execute({
          tool: adapter({ source }).name,
          arguments: { value: 'ok' },
          context: context(source),
        }),
      ).resolves.toMatchObject({ ok: true, output: { source } });
    }
    expect(calls.calls.size).toBe(4);
    expect(effects.effects.size).toBe(0);
  });

  it('五个权限维度逐一fail closed且L2必须先审批', async () => {
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const prepareApproval = vi.fn(async () => ({
      approvalId: 'approval:tool-kernel',
      summary: '运行受控工具',
      expiresAt: '2026-07-21T01:00:00.000Z',
    }));
    const calls = new MemoryCallLedger();
    const kernel = new ToolKernel(
      [adapter({ risk: 'l2', invoke, prepareApproval })],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );
    for (const dimension of toolPolicyDimensions) {
      const trusted = context(dimension);
      trusted.capabilities = { ...trusted.capabilities, [dimension]: [] };
      await expect(
        kernel.execute({
          tool: 'runLocal',
          arguments: { value: 'ok' },
          context: trusted,
        }),
      ).resolves.toMatchObject({
        status: 'denied',
        code: `capability_denied:${dimension}`,
      });
    }
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 42 },
        context: context('invalid-before-approval'),
      }),
    ).resolves.toMatchObject({
      status: 'denied',
      code: 'invalid_arguments',
    });
    expect(prepareApproval).not.toHaveBeenCalled();
    expect(calls.calls.size).toBe(0);
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('approval'),
      }),
    ).resolves.toMatchObject({
      status: 'approval_required',
      code: 'approval_required',
      approval: {
        approvalId: 'approval:tool-kernel',
        capability: 'tool.execute',
        risk: 'l2',
        adapterSource: 'local',
      },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(prepareApproval).toHaveBeenCalledWith(
      { value: 'ok' },
      expect.objectContaining({
        operationId: context('approval').operationId,
        toolCallId: expect.any(String),
      }),
    );
    expect(calls.calls.size).toBe(1);
    expect([...calls.calls.values()][0]?.status).toBe('pending');

    const restartedKernel = new ToolKernel(
      [adapter({ risk: 'l2', invoke, prepareApproval })],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );
    await expect(
      restartedKernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('approval'),
      }),
    ).resolves.toMatchObject({
      status: 'approval_required',
      replayed: true,
      approval: { approvalId: 'approval:tool-kernel' },
    });
    expect(prepareApproval).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('审批描述越界时稳定失败且不执行Adapter', async () => {
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const calls = new MemoryCallLedger();
    const kernel = new ToolKernel(
      [
        adapter({
          risk: 'l2',
          invoke,
          prepareApproval: async () => ({
            approvalId: 'approval:invalid',
            summary: '越界审批',
            expiresAt: '2026-07-23T00:00:01.000Z',
          }),
        }),
      ],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('invalid-approval'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      code: 'approval_preparation_failed',
    });
    expect(invoke).not.toHaveBeenCalled();
    expect([...calls.calls.values()][0]).toMatchObject({
      status: 'failed',
      code: 'approval_preparation_failed',
    });
  });

  it('审批准备前已取消时只结算审计账本且不创建审批', async () => {
    const prepareApproval = vi.fn(async () => ({
      approvalId: 'approval:cancelled',
      summary: '不应创建的审批',
      expiresAt: '2026-07-21T01:00:00.000Z',
    }));
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const calls = new MemoryCallLedger();
    const controller = new AbortController();
    controller.abort('user_cancelled');
    const kernel = new ToolKernel(
      [adapter({ risk: 'l2', invoke, prepareApproval })],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );

    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('cancel-before-approval'),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      status: 'cancelled',
      code: 'tool_cancelled',
      retryable: false,
    });
    expect(prepareApproval).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect([...calls.calls.values()][0]).toMatchObject({
      status: 'failed',
      code: 'tool_cancelled',
    });
  });

  it('相同executionId只执行一次，语义漂移拒绝', async () => {
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const kernel = new ToolKernel(
      [adapter({ invoke })],
      new MemoryCallLedger(),
      new MemoryEffectLedger(),
    );
    const trusted = context('idem');
    const first = await kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'same' },
      context: trusted,
    });
    const replay = await kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'same' },
      context: trusted,
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'changed' },
        context: trusted,
      }),
    ).resolves.toMatchObject({ code: 'idempotency_conflict' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('write超时先留intention并收敛为outcome_unknown', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const kernel = new ToolKernel(
      [
        adapter({
          effect: 'write',
          timeoutMs: 5,
          invoke: async () => new Promise(() => undefined),
        }),
      ],
      calls,
      effects,
    );
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'secret-value' },
        context: context('timeout'),
      }),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      retryable: false,
    });
    expect([...effects.effects.values()]).toMatchObject([
      { status: 'outcome_unknown', code: 'write_outcome_unknown' },
    ]);
    expect([...calls.calls.values()]).toMatchObject([
      { status: 'outcome_unknown', code: 'write_outcome_unknown' },
    ]);
    expect(JSON.stringify(effects.effects)).not.toContain('secret-value');
  });
});
