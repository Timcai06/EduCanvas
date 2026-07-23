import type {
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
} from '@educanvas/agent-core';
import { z } from 'zod';
import type {
  ToolKernelAdapter,
  ToolKernelTrustedContext,
  ToolSource,
} from './tool-kernel';

export class MemoryCallLedger implements AgentToolCallLedgerPort {
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

export class MemoryEffectLedger implements ToolEffectLedgerPort {
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
      reconciliationVerifierId: input.reconciliationVerifierId ?? null,
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

export function context(
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

export function adapter(
  input: {
    source?: ToolSource;
    risk?: 'l0' | 'l2';
    effect?: 'read' | 'write';
    reconciliationVerifierId?: string | null;
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
    reconciliationVerifierId: input.reconciliationVerifierId ?? null,
    timeoutMs: input.timeoutMs ?? 100,
    inputSchema: z.object({ value: z.string().max(100) }).strict(),
    ...(input.modelInputSchema
      ? { modelInputSchema: input.modelInputSchema }
      : {}),
    outputSchema: z.object({ source: z.string() }).strict(),
    ...(input.prepareApproval
      ? { prepareApproval: input.prepareApproval }
      : {}),
    invoke: input.invoke ?? (async () => ({ source })),
  };
}
