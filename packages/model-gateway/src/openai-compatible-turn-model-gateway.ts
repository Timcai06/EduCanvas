import type {
  ModelFinishReason,
  ModelUsage,
  NormalizedModelError,
  ProviderCallMetadata,
  StreamAgentTextRequest,
  TurnModelEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  parseModelGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from './config';
import { readSseData, SseProtocolError } from './sse';

type JsonRecord = Record<string, unknown>;

interface ToolCallState {
  callId: string;
  tool: string;
}

export interface OpenAICompatibleTurnModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SseProtocolError();
  }
  return value;
};

const optionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return requiredString(value);
};

const nonNegativeInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SseProtocolError();
  }
  return value as number;
};

const safeJsonStringify = (value: unknown): string => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new SseProtocolError();
  }
  if (serialized === undefined) throw new SseProtocolError();
  return serialized;
};

const parseUsage = (value: unknown): ModelUsage => {
  if (!isRecord(value)) throw new SseProtocolError();
  const completionDetails = value.completion_tokens_details;
  const reasoningTokens = isRecord(completionDetails)
    ? nonNegativeInteger(completionDetails.reasoning_tokens ?? 0)
    : 0;
  return {
    inputTokens: nonNegativeInteger(value.prompt_tokens),
    outputTokens: nonNegativeInteger(value.completion_tokens),
    cacheHitTokens: nonNegativeInteger(value.prompt_cache_hit_tokens ?? 0),
    reasoningTokens,
  };
};

const parseRetryAfterMs = (
  value: string | null,
  now: number,
): number | undefined => {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
};

const errorForHttpResponse = (
  response: Response,
  now: number,
): NormalizedModelError => {
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(
      response.headers.get('retry-after'),
      now,
    );
    return {
      code: 'rate_limit',
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  if (response.status === 408 || response.status === 504) {
    return { code: 'timeout', retryable: true };
  }
  if (response.status >= 500) {
    return { code: 'unavailable', retryable: true };
  }
  if (response.status === 400 || response.status === 422) {
    return { code: 'invalid_response', retryable: false };
  }
  return { code: 'unavailable', retryable: false };
};

const failedEvent = (
  phase: StreamAgentTextRequest['phase'],
  error: NormalizedModelError,
  metadata?: ProviderCallMetadata,
): TurnModelEvent => ({
  type: 'failed',
  phase,
  error,
  ...(metadata === undefined ? {} : { metadata }),
});

const mapFinishReason = (
  providerReason: string,
): {
  finishReason: ModelFinishReason;
  failure?: NormalizedModelError;
} => {
  switch (providerReason) {
    case 'stop':
    case 'tool_calls':
      return { finishReason: providerReason };
    case 'length':
      return {
        finishReason: 'length',
        failure: { code: 'output_limit', retryable: true },
      };
    case 'content_filter':
      return {
        finishReason: 'content_filter',
        failure: { code: 'content_filtered', retryable: false },
      };
    case 'insufficient_system_resource':
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

const buildProviderMessages = (request: StreamAgentTextRequest): unknown[] => {
  const messages: unknown[] = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  if (request.phase !== 'synthesis') return messages;
  if (request.toolResults.length === 0) throw new SseProtocolError();

  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: request.toolResults.map((result) => ({
      id: result.callId,
      type: 'function',
      function: {
        name: result.tool,
        arguments: safeJsonStringify(result.arguments),
      },
    })),
  });
  for (const result of request.toolResults) {
    messages.push({
      role: 'tool',
      tool_call_id: result.callId,
      content: safeJsonStringify(result.output),
    });
  }
  return messages;
};

const buildRequestBody = (
  request: StreamAgentTextRequest,
  config: EnabledModelGatewayConfiguration,
  modelId: string,
): JsonRecord => ({
  model: modelId,
  messages: buildProviderMessages(request),
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: config.maxOutputTokens,
  tools:
    request.tools.length === 0
      ? undefined
      : request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
  tool_choice: request.tools.length === 0 ? 'none' : 'auto',
  // DeepSeek thinking tool calls require replaying reasoning_content. EduCanvas
  // deliberately never retains CoT, so the adapter forces non-thinking mode.
  ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
});

/** 原生 fetch + SSE 的 OpenAI-compatible Turn Adapter。 */
export class OpenAICompatibleTurnModelGateway implements TurnModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    options: OpenAICompatibleTurnModelGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async *streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent> {
    const modelId = this.config.modelIds[request.modelAlias];
    if (modelId === undefined) {
      yield failedEvent(request.phase, {
        code: 'unavailable',
        retryable: false,
      });
      return;
    }

    let body: string;
    try {
      body = JSON.stringify(buildRequestBody(request, this.config, modelId));
    } catch {
      yield failedEvent(request.phase, {
        code: 'invalid_response',
        retryable: false,
      });
      return;
    }

    const startedAt = this.now();
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) {
      controller.abort();
    } else {
      request.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        yield failedEvent(
          request.phase,
          errorForHttpResponse(response, this.now()),
        );
        return;
      }
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .includes('text/event-stream') ||
        response.body === null
      ) {
        await response.body?.cancel().catch(() => undefined);
        yield failedEvent(request.phase, {
          code: 'invalid_response',
          retryable: false,
        });
        return;
      }

      let responseId: string | null = null;
      let responseModel: string | null = null;
      let systemFingerprint: string | null = null;
      let usage: ModelUsage | null = null;
      let providerFinishReason: string | null = null;
      let sawDone = false;
      const toolCalls = new Map<number, ToolCallState>();

      for await (const data of readSseData(response.body)) {
        if (data === '[DONE]') {
          sawDone = true;
          break;
        }
        let chunk: unknown;
        try {
          chunk = JSON.parse(data) as unknown;
        } catch {
          throw new SseProtocolError();
        }
        if (!isRecord(chunk)) throw new SseProtocolError();

        const chunkId = requiredString(chunk.id);
        const chunkModel = requiredString(chunk.model);
        if (responseId !== null && responseId !== chunkId) {
          throw new SseProtocolError();
        }
        if (responseModel !== null && responseModel !== chunkModel) {
          throw new SseProtocolError();
        }
        responseId = chunkId;
        responseModel = chunkModel;
        const fingerprint = optionalString(chunk.system_fingerprint);
        if (
          fingerprint !== undefined &&
          systemFingerprint !== null &&
          fingerprint !== systemFingerprint
        ) {
          throw new SseProtocolError();
        }
        if (fingerprint !== undefined) systemFingerprint = fingerprint;

        if (!Array.isArray(chunk.choices)) throw new SseProtocolError();
        if (chunk.choices.length === 0) {
          if (
            providerFinishReason === null ||
            chunk.usage === null ||
            chunk.usage === undefined ||
            usage !== null
          ) {
            throw new SseProtocolError();
          }
          usage = parseUsage(chunk.usage);
          yield { type: 'usage', phase: request.phase, usage };
          continue;
        }
        if (chunk.usage !== null && chunk.usage !== undefined) {
          throw new SseProtocolError();
        }
        if (chunk.choices.length !== 1 || providerFinishReason !== null) {
          throw new SseProtocolError();
        }

        const choice = chunk.choices[0];
        if (
          !isRecord(choice) ||
          choice.index !== 0 ||
          !isRecord(choice.delta)
        ) {
          throw new SseProtocolError();
        }
        const delta = choice.delta;
        // reasoning_content is intentionally neither parsed nor emitted.
        if (delta.content !== undefined && delta.content !== null) {
          if (typeof delta.content !== 'string') throw new SseProtocolError();
          if (delta.content.length > 0) {
            if (delta.content.length > 64_000) throw new SseProtocolError();
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: delta.content,
            };
          }
        }

        if (delta.tool_calls !== undefined) {
          if (request.phase !== 'answer' || !Array.isArray(delta.tool_calls)) {
            throw new SseProtocolError();
          }
          for (const rawToolCall of delta.tool_calls) {
            if (!isRecord(rawToolCall)) throw new SseProtocolError();
            if (
              rawToolCall.type !== undefined &&
              rawToolCall.type !== 'function'
            ) {
              throw new SseProtocolError();
            }
            const index = nonNegativeInteger(rawToolCall.index);
            if (index > 127 || !isRecord(rawToolCall.function)) {
              throw new SseProtocolError();
            }
            const existing = toolCalls.get(index);
            const callId = optionalString(rawToolCall.id) ?? existing?.callId;
            const tool =
              optionalString(rawToolCall.function.name) ?? existing?.tool;
            if (
              callId === undefined ||
              tool === undefined ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(callId) ||
              !/^[a-z][A-Za-z0-9]{0,63}$/.test(tool) ||
              (existing !== undefined &&
                (existing.callId !== callId || existing.tool !== tool))
            ) {
              throw new SseProtocolError();
            }
            toolCalls.set(index, { callId, tool });
            const argumentsDelta = rawToolCall.function.arguments;
            if (argumentsDelta !== undefined && argumentsDelta !== null) {
              if (
                typeof argumentsDelta !== 'string' ||
                argumentsDelta.length > 64_000
              ) {
                throw new SseProtocolError();
              }
              if (argumentsDelta.length > 0) {
                yield {
                  type: 'tool_call',
                  phase: 'answer',
                  callId,
                  tool,
                  argumentsDelta,
                  done: false,
                };
              }
            }
          }
        }

        if (choice.finish_reason !== null) {
          providerFinishReason = requiredString(choice.finish_reason);
          if (providerFinishReason === 'tool_calls') {
            if (toolCalls.size === 0) throw new SseProtocolError();
            for (const [, toolCall] of [...toolCalls.entries()].sort(
              ([left], [right]) => left - right,
            )) {
              yield {
                type: 'tool_call',
                phase: 'answer',
                callId: toolCall.callId,
                tool: toolCall.tool,
                argumentsDelta: '',
                done: true,
              };
            }
          } else if (toolCalls.size > 0) {
            throw new SseProtocolError();
          }
        }
      }

      if (
        !sawDone ||
        responseId === null ||
        responseModel === null ||
        usage === null ||
        providerFinishReason === null
      ) {
        throw new SseProtocolError();
      }
      const finish = mapFinishReason(providerFinishReason);
      const metadata: ProviderCallMetadata = {
        providerResponseId: responseId,
        provider: this.config.provider,
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: modelId,
        modelRevision: responseModel,
        systemFingerprint,
        finishReason: finish.finishReason,
        usage,
        latencyMs: Math.max(0, this.now() - startedAt),
        traceId: request.traceId,
      };
      if (finish.failure !== undefined) {
        yield failedEvent(request.phase, finish.failure, metadata);
      } else {
        yield { type: 'completed', phase: request.phase, metadata };
      }
    } catch (error) {
      const normalized: NormalizedModelError = timedOut
        ? { code: 'timeout', retryable: true }
        : request.signal?.aborted === true ||
            (isRecord(error) && error.name === 'AbortError')
          ? { code: 'aborted', retryable: false }
          : error instanceof SseProtocolError
            ? { code: 'invalid_response', retryable: false }
            : { code: 'unavailable', retryable: true };
      yield failedEvent(request.phase, normalized);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
      if (!controller.signal.aborted) controller.abort();
    }
  }
}

export function createTurnModelGatewayFromEnvironment(
  environment: ModelGatewayEnvironment,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): OpenAICompatibleTurnModelGateway | null {
  const config = parseModelGatewayConfiguration(environment);
  return config.enabled
    ? new OpenAICompatibleTurnModelGateway(config, options)
    : null;
}
