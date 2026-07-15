import 'server-only';

import {
  DrizzleChatRepository,
  DrizzleModelRunRepository,
  type ModelRunProviderResult,
  type ModelRunSnapshot,
  type ModelRunTerminalStatus,
} from '@educanvas/db';
import {
  ModelGatewayInvocationError,
  turnModelEventSchema,
  type ProviderCallMetadata,
  type StreamTurnTextRequest,
  type TurnModelEvent,
  type TurnModelGateway,
} from '@educanvas/teaching-core';
import { hashPromptMaterial } from './prompt-hash';

export interface AuditedTeachingTurnContext {
  trustedStudentId: string;
  sessionId: string;
  turnId: string;
  assistantMessageId: string;
  traceId: string;
  provider: string;
  answerRun: ModelRunSnapshot;
}

const promptMaterialForRequest = (request: StreamTurnTextRequest) => ({
  taskAlias: request.taskAlias,
  modelAlias: request.modelAlias,
  phase: request.phase,
  promptVersion: request.promptVersion,
  messages: request.messages,
  tools: request.tools,
  ...(request.phase === 'synthesis'
    ? { toolResults: request.toolResults }
    : {}),
});

const toProviderResult = (
  metadata: ProviderCallMetadata | undefined,
): ModelRunProviderResult | undefined =>
  metadata
    ? {
        provider: metadata.provider,
        providerModelId: metadata.resolvedModelId,
        modelRevision: metadata.modelRevision,
        providerResponseId: metadata.providerResponseId,
        systemFingerprint: metadata.systemFingerprint,
        finishReason: metadata.finishReason,
        latencyMs: Math.round(metadata.latencyMs),
        usage: {
          inputTokens: metadata.usage.inputTokens,
          outputTokens: metadata.usage.outputTokens,
          cacheHitTokens: metadata.usage.cacheHitTokens,
          reasoningTokens: metadata.usage.reasoningTokens,
        },
      }
    : undefined;

/**
 * 在 Provider 调用外包一层持久审计：pending run 已在短事务中创建，调用前改为
 * running，终态再条件收敛。该类不保存 Prompt、正文或 reasoning_content。
 */
export class AuditedTurnModelGateway implements TurnModelGateway {
  private readonly runs = new DrizzleModelRunRepository();
  private readonly chat = new DrizzleChatRepository();
  private readonly startedPhases = new Set<StreamTurnTextRequest['phase']>();

  constructor(
    private readonly delegate: TurnModelGateway,
    private readonly context: AuditedTeachingTurnContext,
  ) {}

  private assertRequestContext(request: StreamTurnTextRequest): void {
    if (
      request.turnId !== this.context.turnId ||
      request.traceId !== this.context.traceId ||
      request.taskAlias !== 'teaching.turn'
    ) {
      throw new ModelGatewayInvocationError({
        code: 'invalid_response',
        retryable: false,
      });
    }
    if (this.startedPhases.has(request.phase)) {
      throw new ModelGatewayInvocationError({
        code: 'invalid_response',
        retryable: false,
      });
    }
    this.startedPhases.add(request.phase);
  }

  private async prepareRun(
    request: StreamTurnTextRequest,
  ): Promise<ModelRunSnapshot> {
    const promptHash = hashPromptMaterial(promptMaterialForRequest(request));
    let run: ModelRunSnapshot;
    if (request.phase === 'answer') {
      run = this.context.answerRun;
      if (
        run.promptHash !== promptHash ||
        run.promptVersion !== request.promptVersion ||
        run.modelAlias !== request.modelAlias ||
        run.traceId !== request.traceId
      ) {
        throw new ModelGatewayInvocationError({
          code: 'invalid_response',
          retryable: false,
        });
      }
    } else {
      const created = await this.runs.createOrGetTeachingRun({
        sessionId: this.context.sessionId,
        trustedStudentId: this.context.trustedStudentId,
        operationId: this.context.turnId,
        assistantMessageId: this.context.assistantMessageId,
        turnId: this.context.turnId,
        phase: 'synthesis',
        traceId: request.traceId,
        taskAlias: 'teaching.turn',
        modelAlias: request.modelAlias,
        promptVersion: request.promptVersion,
        promptHash,
        provider: this.context.provider,
      });
      run = created.run;
    }

    const running = await this.runs.markRunning({
      sessionId: this.context.sessionId,
      trustedStudentId: this.context.trustedStudentId,
      runId: run.id,
    });
    if (!running.transitioned) {
      throw new ModelGatewayInvocationError({
        code: 'unavailable',
        retryable: false,
      });
    }
    return running.run;
  }

  private async settleRun(
    runId: string,
    status: ModelRunTerminalStatus,
    errorCode: string | null,
    metadata?: ProviderCallMetadata,
  ): Promise<void> {
    await this.runs.settle({
      sessionId: this.context.sessionId,
      trustedStudentId: this.context.trustedStudentId,
      runId,
      status,
      errorCode,
      providerResult: toProviderResult(metadata),
    });
  }

  async *streamTurnText(
    request: StreamTurnTextRequest,
  ): AsyncIterable<TurnModelEvent> {
    this.assertRequestContext(request);
    let run: ModelRunSnapshot | null = null;
    let terminalPersisted = false;
    try {
      run = await this.prepareRun(request);
      let terminal:
        | Extract<TurnModelEvent, { type: 'completed' | 'failed' }>
        | null = null;
      for await (const rawEvent of this.delegate.streamTurnText(request)) {
        const parsed = turnModelEventSchema.safeParse(rawEvent);
        if (!parsed.success || terminal !== null) {
          throw new ModelGatewayInvocationError({
            code: 'invalid_response',
            retryable: false,
          });
        }
        const event = parsed.data;
        if (event.phase !== request.phase) {
          throw new ModelGatewayInvocationError({
            code: 'invalid_response',
            retryable: false,
          });
        }
        if (event.type === 'completed' || event.type === 'failed') {
          const metadata = event.metadata;
          if (
            metadata &&
            (metadata.taskAlias !== request.taskAlias ||
              metadata.modelAlias !== request.modelAlias ||
              metadata.traceId !== request.traceId)
          ) {
            throw new ModelGatewayInvocationError({
              code: 'invalid_response',
              retryable: false,
            });
          }
          terminal = event;
          continue;
        }
        yield event;
      }
      if (!terminal) {
        throw new ModelGatewayInvocationError({
          code: 'invalid_response',
          retryable: false,
        });
      }
      if (terminal.type === 'completed') {
        await this.settleRun(run.id, 'succeeded', null, terminal.metadata);
      } else {
        let status: ModelRunTerminalStatus = 'failed';
        if (terminal.error.code === 'aborted') {
          const explicitlyCancelled =
            await this.chat.isTurnCancellationRequested({
              trustedStudentId: this.context.trustedStudentId,
              turnId: this.context.turnId,
            });
          status = explicitlyCancelled ? 'cancelled' : 'interrupted';
        }
        await this.settleRun(
          run.id,
          status,
          terminal.error.code,
          terminal.metadata,
        );
      }
      terminalPersisted = true;
      yield terminal;
    } catch (error) {
      if (run && !terminalPersisted) {
        await this.settleRun(run.id, 'interrupted', 'stream_interrupted').catch(
          () => undefined,
        );
      }
      if (error instanceof ModelGatewayInvocationError) throw error;
      throw new ModelGatewayInvocationError(
        { code: 'unavailable', retryable: true },
        { cause: error },
      );
    } finally {
      if (run && !terminalPersisted) {
        await this.settleRun(run.id, 'interrupted', 'stream_interrupted').catch(
          () => undefined,
        );
      }
    }
  }
}
