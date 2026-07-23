import type {
  ModelUsage,
  NormalizedModelError,
  ProviderCallMetadata,
  StreamAgentTextRequest,
  TurnModelEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import { type EnabledModelGatewayConfiguration } from './config';
import {
  buildRequestBody,
  errorForHttpResponse,
  failedEvent,
  isRecord,
  mapFinishReason,
  nonNegativeInteger,
  optionalString,
  parseUsage,
  requiredString,
} from './openai-compatible-protocol';
import { readSseData, SseProtocolError } from './sse';

interface ToolCallState {
  callId: string;
  tool: string;
}

export interface OpenAICompatibleTurnModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

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

        // OpenAI 会在末尾追加 choices=[] 的 usage chunk；DeepSeek V4 则把
        // usage 放在携带 finish_reason 的最后一个 choice chunk。两种布局都
        // 属于其公开兼容协议，但 usage 只能出现一次且不得早于终止原因。
        if (chunk.usage !== null && chunk.usage !== undefined) {
          if (providerFinishReason === null || usage !== null) {
            throw new SseProtocolError();
          }
          usage = parseUsage(chunk.usage);
          yield { type: 'usage', phase: request.phase, usage };
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
