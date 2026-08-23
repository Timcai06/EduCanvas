import {
  ModelGatewayInvocationError,
  PLATFORM_EMBEDDING_DIMENSIONS,
  type EmbeddingDescriptor,
  type EmbeddingModelGateway,
  type EmbeddingRequest,
  type EmbeddingResult,
  type NormalizedModelError,
  type ProviderCallMetadata,
} from '@educanvas/agent-core';
import type { EnabledModelGatewayConfiguration } from './config/config';

export interface OpenAICompatibleEmbeddingModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * 指令版本。指令一旦变化，旧向量就不再与新向量同空间，因此它随向量落库并参与
 * 唯一键——升级指令等于一次显式的重嵌入，而不是就地覆盖。
 */
export const EMBEDDING_INSTRUCTION_VERSION = 'v1' as const;

/** 单条输入的字符上限；超长切块应在切块阶段解决，不在这里静默截断。 */
const MAX_INPUT_CHARACTERS = 8_000;

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
 * OpenAI-compatible `/embeddings` 适配器。
 *
 * 校验比其他适配器更严格，因为向量的错误是静默的：维度不符、条目顺序错乱或
 * 出现 NaN 都不会让调用崩溃，只会让检索结果长期不可解释。因此这里逐条验证
 * 数量、`index` 覆盖、维度和每个分量的有限性，任一不符即整批拒绝。
 *
 * 供应商原始响应止步于此；返回值只含向量、向量身份与审计元数据。
 */
export class OpenAICompatibleEmbeddingModelGateway implements EmbeddingModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    options: OpenAICompatibleEmbeddingModelGatewayOptions = {},
  ) {
    if (!config.modelIds.embedding) {
      throw new TypeError('embedding model alias 未配置');
    }
    if (!config.embeddingModelVersion) {
      throw new TypeError('embedding model version 未配置');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const inputs = request.inputs.map((input) => input.trim());
    if (
      inputs.length === 0 ||
      inputs.length > this.config.embeddingMaxBatch ||
      inputs.some(
        (input) => input.length === 0 || input.length > MAX_INPUT_CHARACTERS,
      )
    ) {
      throw invocationError({ code: 'output_limit', retryable: false });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.embeddingTimeoutMs);
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) controller.abort();
    else
      request.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });

    const modelId = this.config.modelIds.embedding!;
    const startedAt = this.now();
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.config.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            input: inputs,
            /* 显式声明维度：供应商默认维度变化时应当报错，而不是静默写入
               与索引列不符的向量。 */
            dimensions: PLATFORM_EMBEDDING_DIMENSIONS,
            encoding_format: 'float',
          }),
          signal: controller.signal,
        });
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

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      }

      const embeddings = readOrderedEmbeddings(body, inputs.length);
      const descriptor: EmbeddingDescriptor = {
        provider: this.config.provider,
        model: modelId,
        modelVersion: this.config.embeddingModelVersion!,
        dimensions: PLATFORM_EMBEDDING_DIMENSIONS,
        instruction: `${request.purpose}:${EMBEDDING_INSTRUCTION_VERSION}`,
      };
      const metadata: ProviderCallMetadata = {
        providerResponseId: response.headers.get('x-request-id'),
        provider: this.config.provider,
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: modelId,
        modelRevision: descriptor.modelVersion,
        systemFingerprint: null,
        finishReason: 'stop',
        usage: {
          inputTokens: readPromptTokens(body),
          outputTokens: 0,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
        latencyMs: Math.max(0, this.now() - startedAt),
        traceId: request.traceId,
      };
      return { embeddings, descriptor, metadata };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * 按 `index` 重排并逐条校验。供应商不保证返回顺序，靠数组下标对齐会在乱序时
 * 把 A 的向量写到 B 的切块上——这是一种不会报错、只会让检索长期错乱的故障。
 */
function readOrderedEmbeddings(
  body: unknown,
  expectedCount: number,
): readonly (readonly number[])[] {
  if (typeof body !== 'object' || body === null) {
    throw invocationError({ code: 'invalid_response', retryable: false });
  }
  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw invocationError({ code: 'invalid_response', retryable: false });
  }

  const ordered = new Array<readonly number[] | undefined>(expectedCount);
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    const record = entry as Record<string, unknown>;
    const index = record.index;
    if (
      !Number.isInteger(index) ||
      (index as number) < 0 ||
      (index as number) >= expectedCount ||
      ordered[index as number] !== undefined
    ) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    const vector = record.embedding;
    if (
      !Array.isArray(vector) ||
      vector.length !== PLATFORM_EMBEDDING_DIMENSIONS ||
      vector.some(
        (component) =>
          typeof component !== 'number' || !Number.isFinite(component),
      )
    ) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    ordered[index as number] = vector as number[];
  }
  if (ordered.some((vector) => vector === undefined)) {
    throw invocationError({ code: 'invalid_response', retryable: false });
  }
  return ordered as readonly (readonly number[])[];
}

/** usage 缺失不是错误：不同供应商对 embedding 的计数字段并不统一。 */
function readPromptTokens(body: unknown): number {
  const usage = (body as { usage?: unknown } | null)?.usage;
  const tokens = (usage as { prompt_tokens?: unknown } | undefined)
    ?.prompt_tokens;
  return typeof tokens === 'number' &&
    Number.isSafeInteger(tokens) &&
    tokens >= 0
    ? tokens
    : 0;
}
