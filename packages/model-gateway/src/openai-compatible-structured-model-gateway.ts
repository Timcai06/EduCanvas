import {
  ModelGatewayInvocationError,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type StructuredModelGateway,
  type StructuredModelRequest,
  type StructuredModelResult,
} from '@educanvas/agent-core';
import { z } from 'zod';
import type { EnabledModelGatewayConfiguration } from './config';

export interface OpenAICompatibleStructuredModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const invocationError = (
  normalized: NormalizedModelError,
  cause?: unknown,
): ModelGatewayInvocationError =>
  new ModelGatewayInvocationError(normalized, { cause });

const errorForHttpStatus = (status: number): NormalizedModelError => {
  if (status === 429) return { code: 'rate_limit', retryable: true };
  if (status >= 500) return { code: 'unavailable', retryable: true };
  return { code: 'invalid_response', retryable: false };
};

/**
 * OpenAI-compatible 的结构化生成适配器(StructuredModelGateway)。
 * 与 Turn 适配器的边界一致:供应商模型 ID、原始响应与 Key 不越过本文件;
 * 差异在于非流式 + `response_format: json_object`,输出先 JSON.parse 再过
 * 调用方的 Zod Schema——两道都不过就是 `invalid_response`,不做静默修复。
 * JSON Schema 说明作为**机械协议**由适配器注入尾部 system 消息;业务提示词
 * 仍完全由调用方拥有。
 */
export class OpenAICompatibleStructuredModelGateway
  implements StructuredModelGateway
{
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    options: OpenAICompatibleStructuredModelGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generateStructured<Output>(
    request: StructuredModelRequest<Output>,
  ): Promise<StructuredModelResult<Output>> {
    const modelId =
      this.config.modelIds[request.modelAlias] ?? this.config.modelIds.primary;

    const jsonSchema = JSON.stringify(z.toJSONSchema(request.schema));
    const body = JSON.stringify({
      model: modelId,
      stream: false,
      response_format: { type: 'json_object' },
      max_tokens: this.config.maxOutputTokens,
      messages: [
        ...request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        {
          role: 'system',
          content: `你必须只输出一个 JSON 对象,不含任何其他文本或代码围栏,且严格符合以下 JSON Schema:\n${jsonSchema}`,
        },
      ],
    });

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) controller.abort();
    else request.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const startedAt = this.now();
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.config.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              'content-type': 'application/json',
            },
            body,
            signal: controller.signal,
          },
        );
      } catch (cause) {
        if (timedOut) {
          throw invocationError({ code: 'timeout', retryable: true }, cause);
        }
        if (request.signal?.aborted === true) {
          throw invocationError({ code: 'aborted', retryable: false }, cause);
        }
        throw invocationError({ code: 'unavailable', retryable: true }, cause);
      }

      if (!response.ok) {
        throw invocationError(errorForHttpStatus(response.status));
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      }

      const parsedPayload = completionPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) {
        throw invocationError({ code: 'invalid_response', retryable: false });
      }
      const choice = parsedPayload.data.choices[0];
      if (!choice) {
        throw invocationError({ code: 'invalid_response', retryable: false });
      }
      if (choice.finish_reason === 'length') {
        throw invocationError({ code: 'output_limit', retryable: true });
      }
      if (choice.finish_reason === 'content_filter') {
        throw invocationError({ code: 'content_filtered', retryable: false });
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(choice.message.content);
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      }
      const output = request.schema.safeParse(parsedJson);
      if (!output.success) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          output.error,
        );
      }

      const usage = parsedPayload.data.usage;
      const metadata: ProviderCallMetadata = {
        providerResponseId: parsedPayload.data.id ?? null,
        provider: this.config.provider,
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: parsedPayload.data.model ?? modelId,
        modelRevision: parsedPayload.data.model ?? null,
        systemFingerprint: parsedPayload.data.system_fingerprint ?? null,
        finishReason: choice.finish_reason === 'stop' ? 'stop' : 'other',
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          cacheHitTokens: usage?.prompt_cache_hit_tokens ?? 0,
          reasoningTokens: 0,
        },
        latencyMs: Math.max(0, this.now() - startedAt),
        traceId: request.traceId,
      };
      return { output: output.data, metadata };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

/** 只解析审计与解包所需字段;未知字段一律忽略,不透传。 */
const completionPayloadSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    system_fingerprint: z.string().optional(),
    choices: z
      .array(
        z.object({
          finish_reason: z.string().nullable().optional(),
          message: z.object({ content: z.string() }),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .loose();
