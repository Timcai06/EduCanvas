import {
  ModelGatewayInvocationError,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type SpeechModelGateway,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from '@educanvas/agent-core';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';
import {
  DashScopeInvalidResponseError,
  readBoundedJson,
} from './dashscope-http';

export interface DashScopeSpeechModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MAX_INPUT_CHARACTERS = 3_500;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
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

function trustedAudioUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.toLowerCase().endsWith('.oss-cn-beijing.aliyuncs.com')
    ) {
      return null;
    }
    url.protocol = 'https:';
    return url;
  } catch {
    return null;
  }
}

async function readBoundedAudio(response: Response): Promise<Uint8Array> {
  const contentType =
    response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
  if (
    !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(
      contentType,
    )
  )
    throw invocationError({ code: 'invalid_response', retryable: false });
  if (!response.body)
    throw invocationError({ code: 'invalid_response', retryable: false });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw invocationError({ code: 'output_limit', retryable: false });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0)
    throw invocationError({ code: 'invalid_response', retryable: false });
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class DashScopeSpeechModelGateway implements SpeechModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly configuration: DashScopeSpeechConfiguration,
    options: DashScopeSpeechModelGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generateSpeech(
    request: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisResult> {
    const input = request.input.trim();
    if (
      !input ||
      [...input].length > MAX_INPUT_CHARACTERS ||
      request.format !== 'mp3'
    ) {
      throw invocationError({ code: 'output_limit', retryable: false });
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
      const endpoint = `https://${this.configuration.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.configuration.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.configuration.ttsModel,
          input: {
            text: input,
            voice: this.configuration.voice,
            format: 'mp3',
            language_hints: ['zh'],
          },
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) throw httpError(response.status);
      const body = await readBoundedJson(response, MAX_JSON_BYTES);
      const record = body as {
        request_id?: unknown;
        output?: { finish_reason?: unknown; audio?: { url?: unknown } };
      };
      const audioUrl = trustedAudioUrl(record.output?.audio?.url);
      if (record.output?.finish_reason !== 'stop' || !audioUrl)
        throw invocationError({ code: 'invalid_response', retryable: false });
      const audioResponse = await this.fetchImpl(audioUrl, {
        signal: controller.signal,
        redirect: 'error',
      });
      if (!audioResponse.ok) throw httpError(audioResponse.status);
      const bytes = await readBoundedAudio(audioResponse);
      const metadata: ProviderCallMetadata = {
        providerResponseId:
          typeof record.request_id === 'string' ? record.request_id : null,
        provider: 'dashscope',
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: this.configuration.ttsModel,
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
        inputCharacters: [...input].length,
        voice: this.configuration.voice,
        metadata,
      };
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
