import type {
  ModelFinishReason,
  ModelUsage,
  NormalizedModelError,
  ProviderCallMetadata,
  StreamAgentTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';
import type { EnabledModelGatewayConfiguration } from './config';
import { SseProtocolError } from './sse';

/** @internal 仅表示通过运行时对象形状检查后的供应商JSON对象。 */
export type JsonRecord = Record<string, unknown>;

/** @internal 在读取供应商字段前收窄未知JSON；数组不视为对象。 */
export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** @internal 读取供应商必填非空字符串，否则以协议错误终止本次调用。 */
export const requiredString = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SseProtocolError();
  }
  return value;
};

/** @internal 读取供应商可选字符串；null与undefined均表示缺失。 */
export const optionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return requiredString(value);
};

/** @internal 读取供应商非负安全整数，拒绝负数、小数与溢出值。 */
export const nonNegativeInteger = (value: unknown): number => {
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

/** @internal 把供应商usage收敛为领域计量，缺失或异常字段均fail closed。 */
export const parseUsage = (value: unknown): ModelUsage => {
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

/** @internal 只按状态与Retry-After映射安全错误，不读取或外泄响应正文。 */
export const errorForHttpResponse = (
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

/**
 * Emit a development-only diagnostic that is safe to search in local logs.
 * The browser still receives only NormalizedModelError; this helper deliberately
 * excludes the API key, URL, response body, prompt, and provider stack trace.
 */
export const logProviderFailure = (
  provider: string,
  error: NormalizedModelError,
  status?: number,
): void => {
  if (process.env.NODE_ENV !== 'development') return;
  const code =
    status === 401 || status === 403
      ? 'provider_unauthorized'
      : error.code === 'timeout'
        ? 'provider_timeout'
        : error.code === 'invalid_response'
          ? 'provider_invalid_response'
          : `provider_${error.code}`;
  console.warn(`[model-gateway] ${code}`, {
    provider,
    ...(status === undefined ? {} : { status }),
    normalizedCode: error.code,
  });
};

/** @internal 构造稳定失败事件；可选元数据必须已经完成脱敏。 */
export const failedEvent = (
  phase: StreamAgentTextRequest['phase'],
  error: NormalizedModelError,
  metadata?: ProviderCallMetadata,
): TurnModelEvent => ({
  type: 'failed',
  phase,
  error,
  ...(metadata === undefined ? {} : { metadata }),
});

/** @internal 收敛供应商终止原因；未知原因拒绝为异常响应。 */
export const mapFinishReason = (
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
  if (request.phase === 'synthesis' && request.toolResults.length === 0) {
    throw new SseProtocolError();
  }
  if (request.toolResults.length === 0) return messages;
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

/** @internal 把已验证EduCanvas请求投影成OpenAI-compatible请求体。 */
export const buildRequestBody = (
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
  ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
});
