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
import { failedEvent, logProviderFailure } from './openai-compatible-protocol';

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

    // 外部取消与超时都汇总到同一个 controller；该层不保证继续返回“可恢复”失败，
    // 一旦触发就是本次 run 的最终控制流终止。
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
      // 供应商 SDK 对象不越过该适配器：prompt 与 tool schema 在这里重建，
      // 只向下游提供经过本层约束的模型输入。
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
        // AI SDK defaults to console.error(error), which can print Provider raw
        // bodies, credentials and stacks before this adapter normalizes them.
        // The stream still emits its error part; logging happens only through
        // logProviderFailure's closed provider/code/retryable fields below.
        onError: () => undefined,
      });

      let toolCallCount = 0;
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          // 非协议定义的字段不会直接下发给 runtime；全部转换为 TurnEvent 或失败码。
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
          const normalized = normalizeAiSdkError(
            part.error,
            request.signal,
            timedOut,
            this.now(),
          );
          logProviderFailure(this.options.provider, normalized);
          yield failedEvent(request.phase, normalized);
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
      // 捕获 AI SDK/网络/JSON 等异物后统一走 normalizeAiSdkError，统一错误边界。
      const normalized = normalizeAiSdkError(
        error,
        request.signal,
        timedOut,
        this.now(),
      );
      logProviderFailure(this.options.provider, normalized);
      yield failedEvent(request.phase, normalized);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
      if (!controller.signal.aborted) controller.abort();
    }
  }
}
