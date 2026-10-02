import type {
  AgentModelRunLedgerPort,
  AgentModelRunSnapshot,
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  AgentTurnContextLedgerPort,
  StreamTurnTextRequest,
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  TurnApplicationCommand,
} from '@educanvas/agent-core';
import type { PlatformArtifact, PlatformArtifactJob } from '@educanvas/db';

export const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
export const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: uuid(1),
  traceId: 'trace-artifact-truth',
  actor: { actorId: 'subject-1', agentId: uuid(2) },
  notebook: { notebookId: uuid(3), conversationId: uuid(4) },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client-1',
    parts: [{ type: 'text', text: '创建课程文档。' }],
  },
  capabilities: [],
};
export const now = '2026-10-01T00:00:00.000Z';
export const artifact: PlatformArtifact = {
  id: uuid(8),
  spaceId: command.notebook.notebookId,
  conversationId: command.notebook.conversationId,
  ownerSubjectId: command.actor.actorId,
  kind: 'markdown_document',
  trustTier: 'tier1',
  title: '课程文档',
  status: 'proposed',
  latestVersion: 0,
  createdAt: now,
  updatedAt: now,
};
export const job: PlatformArtifactJob = {
  id: uuid(9),
  artifactId: artifact.id,
  operationId: command.operationId,
  status: 'queued',
  progress: null,
  failureCode: null,
  params: {},
  checkpoint: {},
  queueJobKey: `artifact-generate:${artifact.id}`,
};
export const output = {
  artifactId: artifact.id,
  jobId: job.id,
  kind: artifact.kind,
  title: artifact.title,
  status: 'proposed',
};
export const safeSubmission =
  '产物任务已提交，正在后台生成。请在 Canvas 中查看实际进度和结果。';

export function ledgers() {
  const runs: AgentModelRunSnapshot[] = [];
  const modelRunLedger: AgentModelRunLedgerPort = {
    async createOrGet(input) {
      const run: AgentModelRunSnapshot = {
        id: uuid(100 + runs.length),
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
        createdAt: now,
      };
      runs.push(run);
      return { run, replayed: false };
    },
    async markRunning(input) {
      const run = runs.find((value) => value.id === input.runId)!;
      run.status = 'running';
      return { run, transitioned: true };
    },
    async settle(input) {
      const run = runs.find((value) => value.id === input.runId)!;
      run.status = input.status;
      return { run, transitioned: true };
    },
    async listByOperation() {
      return runs;
    },
  };
  const contextLedger: AgentTurnContextLedgerPort = {
    async createOrGet(input) {
      return {
        snapshot: {
          id: uuid(7),
          operationId: input.operationId,
          contextHash: 'c'.repeat(64),
          ...input.material,
          createdAt: now,
        },
        replayed: false,
      };
    },
    async get() {
      return null;
    },
  };
  const calls: AgentToolCallSnapshot[] = [];
  const callLedger: AgentToolCallLedgerPort = {
    async createOrGet(input) {
      const call: AgentToolCallSnapshot = {
        id: uuid(200 + calls.length),
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
        createdAt: now,
      };
      calls.push(call);
      return { call, replayed: false };
    },
    async markRunning(input) {
      const call = calls.find((value) => value.id === input.toolCallId)!;
      call.status = 'running';
      return { call, transitioned: true };
    },
    async settle(input) {
      const call = calls.find((value) => value.id === input.toolCallId)!;
      call.status = input.status;
      call.code = input.code ?? null;
      return { call, transitioned: true };
    },
    async listByOperation() {
      return calls;
    },
  };
  const effects: ToolEffectLedgerSnapshot[] = [];
  const effectLedger: ToolEffectLedgerPort = {
    async intend(input) {
      const effect: ToolEffectLedgerSnapshot = {
        id: uuid(300 + effects.length),
        operationId: input.operationId,
        toolCallId: input.toolCallId,
        effectKey: input.effectKey,
        semanticsHash: input.semanticsHash,
        reconciliationVerifierId: input.reconciliationVerifierId ?? null,
        status: 'intended',
        code: null,
        receiptHash: null,
        intendedAt: now,
        settledAt: null,
      };
      effects.push(effect);
      return { effect, replayed: false };
    },
    async settle(input) {
      const effect = effects.find((value) => value.id === input.effectId)!;
      effect.status = input.status;
      return { effect, transitioned: true };
    },
    async get() {
      return null;
    },
  };
  return {
    modelRunLedger,
    contextLedger,
    callLedger,
    effectLedger,
    calls,
    runs,
  };
}

export function metadata(
  request: StreamTurnTextRequest,
  finishReason: 'stop' | 'tool_calls',
) {
  return {
    providerResponseId: `fixture-${request.phase}`,
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
