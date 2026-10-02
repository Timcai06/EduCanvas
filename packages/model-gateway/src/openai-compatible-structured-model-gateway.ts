import {
  ModelGatewayInvocationError,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type StructuredModelGateway,
  type StructuredModelRequest,
  type StructuredModelResult,
} from '@educanvas/agent-core';
import { z } from 'zod';
import type { EnabledModelGatewayConfiguration } from './config/config';
import { structuredOutputBudget } from './structured-output-budget';

import {
  logProviderInvocationFailure,
  type ProviderFailureDiagnostic,
} from './provider-failure-diagnostics';

export interface OpenAICompatibleStructuredModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** 只供 Worker 长产物组合根选择；不会提高未核实 Provider 的上限。 */
  outputBudget?: 'configured' | 'long_artifact';
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
export class OpenAICompatibleStructuredModelGateway implements StructuredModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    private readonly options: OpenAICompatibleStructuredModelGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generateStructured<Output>(
    request: StructuredModelRequest<Output>,
  ): Promise<StructuredModelResult<Output>> {
    const modelId =
      this.config.modelIds[request.modelAlias] ?? this.config.modelIds.primary;

    let body: string;
    try {
      const jsonSchema = JSON.stringify(z.toJSONSchema(request.schema));
      body = JSON.stringify({
        model: modelId,
        stream: false,
        response_format: { type: 'json_object' },
        max_tokens: structuredOutputBudget(
          this.config,
          modelId,
          this.options.outputBudget === 'long_artifact' &&
            request.taskAlias === 'artifact.generate' &&
            request.modelAlias === 'structured',
          request.maxOutputTokens,
        ),
        ...(this.config.provider === 'deepseek'
          ? { thinking: { type: 'disabled' } }
          : {}),
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
    } catch {
      const failure = invocationError({
        code: 'invalid_response',
        retryable: false,
      });
      logProviderInvocationFailure(this.config.provider, failure, {
        capability: 'structured',
        stage: 'request_build',
      });
      throw failure;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) controller.abort();
    else
      request.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });

    const startedAt = this.now();
    const diagnostic: ProviderFailureDiagnostic = {
      capability: 'structured',
      stage: 'provider_call',
    };
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

      diagnostic.status = response.status;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw invocationError(errorForHttpStatus(response.status));
      }
      diagnostic.stage = 'response_parse';

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        /* 响应头到达后 body 仍可能因超时/外部中止被打断；此时错误发生在
           传输阶段而非协议解析，必须沿用 fetch 阶段的归类，否则真实超时
           会被记成 retryable invalid_response 并耗尽重试窗口。 */
        if (timedOut) {
          throw invocationError({ code: 'timeout', retryable: true }, cause);
        }
        if (request.signal?.aborted === true) {
          throw invocationError({ code: 'aborted', retryable: false }, cause);
        }
        throw invocationError(
          { code: 'invalid_response', retryable: true },
          cause,
        );
      }

      const parsedPayload = completionPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) {
        throw invocationError({ code: 'invalid_response', retryable: true });
      }
      const choice = parsedPayload.data.choices[0];
      if (!choice) {
        throw invocationError({ code: 'invalid_response', retryable: true });
      }
      if (choice.finish_reason === 'length') {
        // 不改变预算或输入的原样重试仍会截断，只会重复计费并拖长失败时间。
        throw invocationError({ code: 'output_limit', retryable: false });
      }
      if (choice.finish_reason === 'content_filter') {
        throw invocationError({ code: 'content_filtered', retryable: false });
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(choice.message.content);
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: true },
          cause,
        );
      }
      const output = request.schema.safeParse(parsedJson);
      if (!output.success) {
        throw invocationError(
          // 模型的结构化输出具有随机性；Worker 只在有界 Graphile 窗口内重试。
          { code: 'invalid_response', retryable: true },
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
    } catch (cause) {
      logProviderInvocationFailure(this.config.provider, cause, diagnostic);
      throw cause;
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
