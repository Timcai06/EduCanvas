import {
  type ModelAlias,
  type ProviderCallMetadata,
  type StreamAgentTextRequest,
  type TurnModelEvent,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import { jsonSchema, streamText, tool, type LanguageModel } from 'ai';
import {
  AiSdkProtocolError,
  buildAiSdkPrompt,
  mapAiSdkFinish,
  mapAiSdkUsage,
  normalizeAiSdkError,
  parseAiSdkEvent,
  stringifyAiSdkToolInput,
} from './ai-sdk-protocol';
import { failedEvent } from './openai-compatible-protocol';

/** @internal SDK Adapter构造依赖；不得由Web、领域层或客户端直接组装。 */
export interface AiSdkTurnModelGatewayOptions {
  provider: string;
  modelIds: Readonly<Partial<Record<ModelAlias, string>>>;
  timeoutMs: number;
  maxOutputTokens: number;
  modelFactory: (modelId: string) => LanguageModel;
  now?: () => number;
}

/** AI SDK流式Turn Adapter；SDK类型、异常与原始流不得越过此类。 */
export class AiSdkTurnModelGateway implements TurnModelGateway {
  private readonly now: () => number;

  constructor(private readonly options: AiSdkTurnModelGatewayOptions) {
    this.now = options.now ?? Date.now;
  }

  async *streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent> {
    if (request.signal?.aborted === true) {
      yield failedEvent(request.phase, { code: 'aborted', retryable: false });
      return;
    }
    const resolvedModelId = this.options.modelIds[request.modelAlias];
    if (resolvedModelId === undefined) {
      yield failedEvent(request.phase, {
        code: 'unavailable',
        retryable: false,
      });
      return;
    }

    const startedAt = this.now();
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
    }, this.options.timeoutMs);

    try {
      const prompt = buildAiSdkPrompt(request);
      const tools = Object.fromEntries(
        request.tools.map((definition) => [
          definition.name,
          tool({
            description: definition.description,
            inputSchema: jsonSchema(
              definition.inputSchema as Parameters<typeof jsonSchema>[0],
            ),
          }),
        ]),
      );
      const result = streamText({
        model: this.options.modelFactory(resolvedModelId),
        instructions: prompt.instructions,
        messages: prompt.messages,
        tools,
        maxOutputTokens: this.options.maxOutputTokens,
        maxRetries: 0,
        abortSignal: controller.signal,
      });

      let toolCallCount = 0;
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield parseAiSdkEvent({
            type: 'text_delta',
            phase: request.phase,
            delta: part.text,
          });
          continue;
        }
        if (part.type === 'tool-call') {
          if (request.phase !== 'answer') {
            yield failedEvent(request.phase, {
              code: 'invalid_response',
              retryable: false,
            });
            return;
          }
          toolCallCount += 1;
          yield parseAiSdkEvent({
            type: 'tool_call',
            phase: request.phase,
            callId: part.toolCallId,
            tool: part.toolName,
            argumentsDelta: stringifyAiSdkToolInput(part.input),
            done: false,
          });
          yield parseAiSdkEvent({
            type: 'tool_call',
            phase: request.phase,
            callId: part.toolCallId,
            tool: part.toolName,
            argumentsDelta: '',
            done: true,
          });
          continue;
        }
        if (part.type === 'abort') {
          yield failedEvent(request.phase, {
            code: timedOut ? 'timeout' : 'aborted',
            retryable: timedOut,
          });
          return;
        }
        if (part.type === 'error') {
          yield failedEvent(
            request.phase,
            normalizeAiSdkError(
              part.error,
              request.signal,
              timedOut,
              this.now(),
            ),
          );
          return;
        }
        if (part.type !== 'finish-step') continue;
        const usage = mapAiSdkUsage(part.usage);
        yield parseAiSdkEvent({
          type: 'usage',
          phase: request.phase,
          usage,
        });
        const finish = mapAiSdkFinish(part.finishReason);
        if (
          (finish.finishReason === 'tool_calls' && toolCallCount === 0) ||
          (finish.finishReason !== 'tool_calls' && toolCallCount > 0)
        ) {
          throw new AiSdkProtocolError();
        }
        const metadata: ProviderCallMetadata = {
          providerResponseId: part.response.id ?? null,
          provider: this.options.provider,
          taskAlias: request.taskAlias,
          modelAlias: request.modelAlias,
          resolvedModelId,
          modelRevision: part.response.modelId ?? null,
          systemFingerprint: null,
          finishReason: finish.finishReason,
          usage,
          latencyMs: Math.max(0, this.now() - startedAt),
          traceId: request.traceId,
        };
        yield finish.failure === undefined
          ? parseAiSdkEvent({
              type: 'completed',
              phase: request.phase,
              metadata,
            })
          : failedEvent(request.phase, finish.failure, metadata);
        return;
      }

      yield failedEvent(request.phase, {
        code: 'invalid_response',
        retryable: false,
      });
    } catch (error) {
      yield failedEvent(
        request.phase,
        normalizeAiSdkError(error, request.signal, timedOut, this.now()),
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
      if (!controller.signal.aborted) controller.abort();
    }
  }
}
