import {
  ModelGatewayInvocationError,
  type AudioTranscriptionModelGateway,
  type AudioTranscriptionRequest,
  type AudioTranscriptionResult,
  type NormalizedModelError,
  type ProviderCallMetadata,
} from '@educanvas/agent-core';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';
import {
  DashScopeInvalidResponseError,
  readBoundedJson,
} from './dashscope-http';

export interface DashScopeAudioTranscriptionModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

const invocationError = (
  normalized: NormalizedModelError,
  cause?: unknown,
): ModelGatewayInvocationError =>
  new ModelGatewayInvocationError(normalized, { cause });

function httpError(status: number): ModelGatewayInvocationError {
  if (status === 429)
    return invocationError({ code: 'rate_limit', retryable: true });
  if (status >= 500)
    return invocationError({ code: 'unavailable', retryable: true });
  return invocationError({ code: 'invalid_response', retryable: false });
}

export class DashScopeAudioTranscriptionModelGateway implements AudioTranscriptionModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly configuration: DashScopeSpeechConfiguration,
    options: DashScopeAudioTranscriptionModelGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async transcribeAudio(
    request: AudioTranscriptionRequest,
  ): Promise<AudioTranscriptionResult> {
    if (
      request.audioBytes.byteLength === 0 ||
      request.audioBytes.byteLength > MAX_AUDIO_BYTES
    ) {
      throw invocationError({
        code:
          request.audioBytes.byteLength === 0
            ? 'invalid_response'
            : 'output_limit',
        retryable: false,
      });
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    const startedAt = this.now();
    try {
      const endpoint = `https://${this.configuration.workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.configuration.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.configuration.dictationModel,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: `data:${request.mimeType};base64,${Buffer.from(request.audioBytes).toString('base64')}`,
                  },
                },
              ],
            },
          ],
          stream: false,
          asr_options: { language: 'zh', enable_itn: true },
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) throw httpError(response.status);
      const body = await readBoundedJson(response, MAX_JSON_BYTES);
      const record = body as {
        choices?: Array<{
          message?: {
            content?: unknown;
            annotations?: Array<{ type?: unknown; language?: unknown }>;
          };
        }>;
        usage?: { seconds?: unknown };
      };
      const message = record.choices?.[0]?.message;
      const text =
        typeof message?.content === 'string' ? message.content.trim() : '';
      if (!text || [...text].length > 500_000)
        throw invocationError({ code: 'invalid_response', retryable: false });
      const annotation = message?.annotations?.find(
        (value) => value.type === 'audio_info',
      );
      const language =
        typeof annotation?.language === 'string' &&
        annotation.language.length <= 64
          ? annotation.language
          : null;
      const seconds = record.usage?.seconds;
      const durationSeconds =
        typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
          ? seconds
          : null;
      const metadata: ProviderCallMetadata = {
        providerResponseId: response.headers.get('x-request-id'),
        provider: 'dashscope',
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: this.configuration.dictationModel,
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
      return { text, language, durationSeconds, metadata };
    } catch (cause) {
      if (cause instanceof ModelGatewayInvocationError) throw cause;
      if (timedOut)
        throw invocationError({ code: 'timeout', retryable: true }, cause);
      if (request.signal?.aborted)
        throw invocationError({ code: 'aborted', retryable: false }, cause);
      if (cause instanceof DashScopeInvalidResponseError)
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      throw invocationError({ code: 'unavailable', retryable: true }, cause);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
    }
  }
}
