import { createHash } from 'node:crypto';
import type {
  AgentModelRunLedgerPort,
  StreamTurnTextRequest,
  TurnApplicationCommand,
} from '@educanvas/agent-core';
import type { ModelRunResult } from '../turn-engine';
import type {
  TurnApplicationCancellationHandle,
  TurnApplicationLifecycleSnapshot,
} from './ports';

/**
 * Model Run 审计生命周期：Prompt hash、provider result 投影与 AuditedModelRunLifecycle。
 * 只负责单次模型运行的账本登记与结算，不拥有主循环；主编排仍在 service.ts。
 */

export interface ModelRunContext {
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

export class AuditedModelRunLifecycle {
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
      taskAlias: input.request.taskAlias,
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
