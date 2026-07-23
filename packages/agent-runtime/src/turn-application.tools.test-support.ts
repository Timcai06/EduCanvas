import type {
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
} from '@educanvas/agent-core';

const OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const TOOL_CALL_ID = '20000000-0000-4000-8000-000000000001';

/** Tool Kernel组合测试专用的内存调用账本。 */
export class MemoryCallLedger implements AgentToolCallLedgerPort {
  readonly calls: AgentToolCallSnapshot[] = [];

  async createOrGet(
    input: Parameters<AgentToolCallLedgerPort['createOrGet']>[0],
  ) {
    const call: AgentToolCallSnapshot = {
      id: TOOL_CALL_ID,
      operationId: input.operationId,
      answerModelRunId: input.answerModelRunId,
      providerToolCallId: input.providerToolCallId,
      executionId: input.executionId,
      traceId: 'trace:turn-application',
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

/** Tool Kernel组合测试专用的内存副作用账本。 */
export class MemoryEffectLedger implements ToolEffectLedgerPort {
  async intend(input: Parameters<ToolEffectLedgerPort['intend']>[0]) {
    const effect: ToolEffectLedgerSnapshot = {
      id: '30000000-0000-4000-8000-000000000001',
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
    return { effect, replayed: false };
  }

  async settle(input: Parameters<ToolEffectLedgerPort['settle']>[0]) {
    return {
      effect: {
        id: input.effectId,
        operationId: OPERATION_ID,
        toolCallId: TOOL_CALL_ID,
        effectKey: 'unused',
        semanticsHash: 'a'.repeat(64),
        reconciliationVerifierId: null,
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
