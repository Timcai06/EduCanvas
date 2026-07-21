import {
  normalizeModelGatewayError,
  turnModelEventSchema,
  type ModelFinishReason,
  type ModelUsage,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type StreamAgentTextRequest,
  type TurnModelEvent,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import {
  jsonSchema,
  streamText,
  tool,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
} from 'ai';

export interface AiSdkResearchTurnModelGatewayOptions {
  provider: string;
  resolvedModelId: string;
  timeoutMs: number;
  now?: () => number;
}

const failedEvent = (
  phase: StreamAgentTextRequest['phase'],
  error: NormalizedModelError,
  metadata?: ProviderCallMetadata,
): TurnModelEvent =>
  turnModelEventSchema.parse({
    type: 'failed',
    phase,
    error,
    ...(metadata === undefined ? {} : { metadata }),
  });

const toJsonValue = (value: unknown): JSONValue => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('invalid_tool_result');
  return JSON.parse(encoded) as JSONValue;
};

const buildPrompt = (
  request: StreamAgentTextRequest,
): { instructions: string | undefined; messages: ModelMessage[] } => {
  const systemMessages = request.messages.filter(
    (message) => message.role === 'system',
  );
  const messages: ModelMessage[] = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
  if (request.phase === 'synthesis' && request.toolResults.length === 0) {
    throw new Error('missing_synthesis_results');
  }
  if (request.toolResults.length === 0) {
    return {
      instructions:
        systemMessages.length === 0
          ? undefined
          : systemMessages.map((message) => message.content).join('\n\n'),
      messages,
    };
  }

  messages.push({
    role: 'assistant',
    content: request.toolResults.map((result) => ({
      type: 'tool-call',
      toolCallId: result.callId,
      toolName: result.tool,
      input: toJsonValue(result.arguments),
    })),
  });
  messages.push({
    role: 'tool',
    content: request.toolResults.map((result) => ({
      type: 'tool-result',
      toolCallId: result.callId,
      toolName: result.tool,
      output: { type: 'json', value: toJsonValue(result.output) },
    })),
  });
  return {
    instructions:
      systemMessages.length === 0
        ? undefined
        : systemMessages.map((message) => message.content).join('\n\n'),
    messages,
  };
};

const mapFinish = (
  reason: string,
): { finishReason: ModelFinishReason; failure?: NormalizedModelError } => {
  switch (reason) {
    case 'stop':
      return { finishReason: 'stop' };
    case 'tool-calls':
      return { finishReason: 'tool_calls' };
    case 'length':
      return {
        finishReason: 'length',
        failure: { code: 'output_limit', retryable: true },
      };
    case 'content-filter':
      return {
        finishReason: 'content_filter',
        failure: { code: 'content_filtered', retryable: false },
      };
    case 'error':
      return {
        finishReason: 'error',
        failure: { code: 'unavailable', retryable: true },
      };
    default:
      return {
        finishReason: 'other',
        failure: { code: 'invalid_response', retryable: false },
      };
  }
};

const mapUsage = (usage: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}): ModelUsage => ({
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  cacheHitTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
});

/**
 * 仅供第二代 Provider 对照实验使用的 AI SDK Adapter，不是生产实现。
 * SDK 原始流、异常、消息与工具类型必须在这里终止，调用方只看 EduCanvas Port。
 */
export class AiSdkResearchTurnModelGateway implements TurnModelGateway {
  private readonly now: () => number;

  constructor(
    private readonly model: LanguageModel,
    private readonly options: AiSdkResearchTurnModelGatewayOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async *streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent> {
    if (request.signal?.aborted === true) {
      yield failedEvent(request.phase, { code: 'aborted', retryable: false });
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
      const prompt = buildPrompt(request);
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
        model: this.model,
        instructions: prompt.instructions,
        messages: prompt.messages,
        tools,
        maxRetries: 0,
        abortSignal: controller.signal,
      });

      let finishSeen = false;
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield turnModelEventSchema.parse({
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
          yield turnModelEventSchema.parse({
            type: 'tool_call',
            phase: request.phase,
            callId: part.toolCallId,
            tool: part.toolName,
            argumentsDelta: JSON.stringify(part.input),
            done: false,
          });
          yield turnModelEventSchema.parse({
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
          yield failedEvent(request.phase, {
            code: timedOut
              ? 'timeout'
              : controller.signal.aborted
                ? 'aborted'
                : 'unavailable',
            retryable: timedOut || !controller.signal.aborted,
          });
          return;
        }
        if (part.type !== 'finish-step') continue;
        if (finishSeen) {
          yield failedEvent(request.phase, {
            code: 'invalid_response',
            retryable: false,
          });
          return;
        }
        finishSeen = true;
        const usage = mapUsage(part.usage);
        yield turnModelEventSchema.parse({
          type: 'usage',
          phase: request.phase,
          usage,
        });
        const finish = mapFinish(part.finishReason);
        const metadata: ProviderCallMetadata = {
          providerResponseId: part.response.id ?? null,
          provider: this.options.provider,
          taskAlias: request.taskAlias,
          modelAlias: request.modelAlias,
          resolvedModelId: this.options.resolvedModelId,
          modelRevision: part.response.modelId ?? null,
          systemFingerprint: null,
          finishReason: finish.finishReason,
          usage,
          latencyMs: Math.max(0, this.now() - startedAt),
          traceId: request.traceId,
        };
        yield finish.failure === undefined
          ? turnModelEventSchema.parse({
              type: 'completed',
              phase: request.phase,
              metadata,
            })
          : failedEvent(request.phase, finish.failure, metadata);
      }

      if (!finishSeen) {
        yield failedEvent(request.phase, {
          code: 'invalid_response',
          retryable: false,
        });
      }
    } catch (error) {
      const normalized = normalizeModelGatewayError(error, request.signal);
      yield failedEvent(
        request.phase,
        timedOut
          ? { code: 'timeout', retryable: true }
          : normalized.code === 'unknown'
            ? { code: 'unavailable', retryable: true }
            : normalized,
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
      if (!controller.signal.aborted) controller.abort();
    }
  }
}
