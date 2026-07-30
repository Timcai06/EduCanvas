import {
  ModelGatewayInvocationError,
  type AudioTranscriptionModelGateway,
  type AudioTranscriptionRequest,
  type AudioTranscriptionResult,
  type NormalizedModelError,
  type ProviderCallMetadata,
} from '@educanvas/agent-core';
import type { EnabledModelGatewayConfiguration } from './config';

export interface OpenAICompatibleAudioTranscriptionModelGatewayOptions {
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
 * OpenAI-compatible `/audio/transcriptions` 适配器。一次请求转录音频字节，
 * 不做内部重试；调用方决定失败终态，避免超时或限流时静默重复计费。
 *
 * 供应商原始响应止步于此，只返回归一化的文本与审计元数据。
 */
export class OpenAICompatibleAudioTranscriptionModelGateway implements AudioTranscriptionModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    options: OpenAICompatibleAudioTranscriptionModelGatewayOptions = {},
  ) {
    if (!config.modelIds.transcription) {
      throw new TypeError('transcription model alias 未配置');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async transcribeAudio(
    request: AudioTranscriptionRequest,
  ): Promise<AudioTranscriptionResult> {
    if (request.audioBytes.byteLength === 0) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    if (
      request.audioBytes.byteLength > this.config.transcriptionMaxInputBytes
    ) {
      throw invocationError({ code: 'output_limit', retryable: false });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.transcriptionTimeoutMs);
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) controller.abort();
    else
      request.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });

    const modelId = this.config.modelIds.transcription!;
    const startedAt = this.now();
    try {
      const mimeToExt: Record<string, string> = {
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
        'audio/x-m4a': 'm4a',
      };
      const ext = mimeToExt[request.mimeType] ?? 'bin';
      const blob = new Blob([request.audioBytes.slice().buffer], {
        type: request.mimeType,
      });
      const file = new File([blob], `audio.${ext}`, {
        type: request.mimeType,
      });

      const formData = new FormData();
      formData.set('model', modelId);
      formData.set('file', file);
      formData.set('response_format', 'json');

      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.config.baseUrl}/audio/transcriptions`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
            },
            body: formData,
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

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      }

      if (
        typeof body !== 'object' ||
        body === null ||
        typeof (body as Record<string, unknown>).text !== 'string'
      ) {
        throw invocationError({ code: 'invalid_response', retryable: false });
      }

      const text = (body as { text: string }).text;
      if (!text.trim() || [...text].length > 500_000) {
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

      const language =
        typeof (body as Record<string, unknown>).language === 'string' &&
        (body as { language: string }).language.trim().length > 0 &&
        (body as { language: string }).language.length <= 64
          ? (body as { language: string }).language.trim()
          : null;
      const durationRaw = (body as Record<string, unknown>).duration;
      const durationSeconds =
        typeof durationRaw === 'number' &&
        Number.isFinite(durationRaw) &&
        durationRaw > 0 &&
        durationRaw <= 86_400
          ? durationRaw
          : null;

      return {
        text: text.trim(),
        language,
        durationSeconds,
        metadata,
      };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
