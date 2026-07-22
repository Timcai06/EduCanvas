import type {
  ModelFinishReason,
  ModelUsage,
  NormalizedModelError,
  StreamAgentTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';
import {
  normalizeModelGatewayError,
  turnModelEventSchema,
} from '@educanvas/agent-core';
import { APICallError, type JSONValue, type ModelMessage } from 'ai';

/** @internal 标记由SDK输出或Adapter投影违反稳定协议，不携带原始值。 */
export class AiSdkProtocolError extends Error {
  override readonly name = 'AiSdkProtocolError';

  constructor() {
    super('invalid_ai_sdk_protocol');
  }
}

const toJsonValue = (value: unknown): JSONValue => {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new AiSdkProtocolError();
    return JSON.parse(encoded) as JSONValue;
  } catch {
    throw new AiSdkProtocolError();
  }
};

/** @internal AI SDK消息投影，只能在SDK Adapter内部消费。 */
export interface AiSdkPrompt {
  instructions: string | undefined;
  messages: ModelMessage[];
}

/** @internal 把稳定Turn请求投影为AI SDK消息，SDK类型在Adapter内终止。 */
export function buildAiSdkPrompt(request: StreamAgentTextRequest): AiSdkPrompt {
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
    throw new AiSdkProtocolError();
  }
  if (request.toolResults.length > 0) {
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
  }
  return {
    instructions:
      systemMessages.length === 0
        ? undefined
        : systemMessages.map((message) => message.content).join('\n\n'),
    messages,
  };
}

/** @internal 把AI SDK终止原因收敛为稳定领域原因与失败语义。 */
export function mapAiSdkFinish(reason: string): {
  finishReason: ModelFinishReason;
  failure?: NormalizedModelError;
} {
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
}

interface AiSdkUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}

/** @internal 把AI SDK usage收敛为不含供应商类型的稳定计量。 */
export function mapAiSdkUsage(usage: AiSdkUsage): ModelUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheHitTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

/** @internal 校验SDK投影事件，失败时不传播Zod细节或供应商原值。 */
export function parseAiSdkEvent(value: unknown): TurnModelEvent {
  const parsed = turnModelEventSchema.safeParse(value);
  if (!parsed.success) throw new AiSdkProtocolError();
  return parsed.data;
}

/** @internal 把SDK已解析工具输入安全编码为稳定增量字符串。 */
export function stringifyAiSdkToolInput(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded.length > 64_000) {
      throw new AiSdkProtocolError();
    }
    return encoded;
  } catch {
    throw new AiSdkProtocolError();
  }
}

const retryAfterMs = (
  headers: Record<string, string> | undefined,
  now: number,
): number | undefined => {
  const value = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'retry-after',
  )?.[1];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
};

/** @internal 只读取SDK错误类型、状态与响应头，绝不转发正文、URL或请求值。 */
export function normalizeAiSdkError(
  error: unknown,
  signal: StreamAgentTextRequest['signal'],
  timedOut: boolean,
  now: number,
): NormalizedModelError {
  if (timedOut) return { code: 'timeout', retryable: true };
  if (error instanceof AiSdkProtocolError) {
    return { code: 'invalid_response', retryable: false };
  }
  const normalized = normalizeModelGatewayError(error, signal);
  if (normalized.code !== 'unknown') return normalized;
  if (!APICallError.isInstance(error)) {
    return { code: 'unavailable', retryable: true };
  }
  const status = error.statusCode;
  if (status === 429) {
    const wait = retryAfterMs(error.responseHeaders, now);
    return {
      code: 'rate_limit',
      retryable: true,
      ...(wait === undefined ? {} : { retryAfterMs: wait }),
    };
  }
  if (status === 408 || status === 504) {
    return { code: 'timeout', retryable: true };
  }
  if (status !== undefined && status >= 500) {
    return { code: 'unavailable', retryable: true };
  }
  if (status === 400 || status === 422) {
    return { code: 'invalid_response', retryable: false };
  }
  return { code: 'unavailable', retryable: error.isRetryable };
}
