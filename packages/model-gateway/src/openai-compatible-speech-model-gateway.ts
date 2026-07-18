import {
  ModelGatewayInvocationError,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type SpeechModelGateway,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from '@educanvas/agent-core';
import type { EnabledModelGatewayConfiguration } from './config';

export interface OpenAICompatibleSpeechModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

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
 * OpenAI-compatible `/audio/speech` 适配器。一次请求最多合成配置上限字符，
 * 不做内部重试；调用方决定失败终态，避免超时或限流时静默重复计费。
 */
export class OpenAICompatibleSpeechModelGateway
  implements SpeechModelGateway
{
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    options: OpenAICompatibleSpeechModelGatewayOptions = {},
  ) {
    if (!config.modelIds.speech) {
      throw new TypeError('speech model alias 未配置');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generateSpeech(
    request: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisResult> {
    const input = request.input.trim();
    if (
      input.length < 1 ||
      input.length > this.config.speechMaxInputChars ||
      request.format !== 'mp3'
    ) {
      throw invocationError({ code: 'output_limit', retryable: false });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.speechTimeoutMs);
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) controller.abort();
    else request.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const modelId = this.config.modelIds.speech!;
    const startedAt = this.now();
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.config.baseUrl}/audio/speech`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: modelId,
              voice: this.config.speechVoice,
              input,
              response_format: 'mp3',
            }),
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
      const responseContentType =
        response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
      if (
        !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(
          responseContentType,
        )
      ) {
        throw invocationError({ code: 'invalid_response', retryable: false });
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
        throw invocationError({ code: 'output_limit', retryable: false });
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
        throw invocationError({ code: 'invalid_response', retryable: false });
      }

      const metadata: ProviderCallMetadata = {
        providerResponseId: response.headers.get('x-request-id'),
        provider: this.config.provider,
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: modelId,
        modelRevision: null,
        systemFingerprint: null,
        finishReason: 'stop',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
        latencyMs: Math.max(0, this.now() - startedAt),
        traceId: request.traceId,
      };
      return {
        bytes,
        contentType: 'audio/mpeg',
        inputCharacters: input.length,
        voice: this.config.speechVoice,
        metadata,
      };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
