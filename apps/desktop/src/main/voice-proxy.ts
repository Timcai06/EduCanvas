import type {
  VoiceAudioInput,
  VoiceFailure,
  VoiceSpeechResult,
  VoiceTranscriptionResult,
} from '../shared/voice-result';

export interface VoiceProxy {
  transcribe(
    input: VoiceAudioInput,
    signal?: AbortSignal,
  ): Promise<VoiceTranscriptionResult>;
  synthesize(
    input: { text: string },
    signal?: AbortSignal,
  ): Promise<VoiceSpeechResult>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_SPEECH_BYTES = 20 * 1024 * 1024;

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function httpFailure(body: unknown): VoiceFailure {
  const message = (body as { error?: { message?: unknown } } | null)?.error
    ?.message;
  return {
    ok: false,
    code: 'http',
    message: typeof message === 'string' ? message : '语音服务暂不可用。',
  };
}

/**
 * Electron main → 本地 Web BFF 的有界语音代理。只返回文本或音频字节，
 * Provider headers、metadata、原始错误和 Secret 都止于服务端。
 */
export function createVoiceProxy(
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    timeoutMs?: number;
  } = {},
): VoiceProxy {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:3101').replace(
    /\/$/,
    '',
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function run<T>(
    signal: AbortSignal | undefined,
    request: (combinedSignal: AbortSignal) => Promise<T>,
  ): Promise<T | VoiceFailure> {
    if (signal?.aborted)
      return { ok: false, code: 'aborted', message: '已取消。' };
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
      return await Promise.race([request(controller.signal), aborted]);
    } catch (error) {
      if (signal?.aborted)
        return { ok: false, code: 'aborted', message: '已取消。' };
      if (timedOut)
        return {
          ok: false,
          code: 'timeout',
          message: '语音请求超时，请重试。',
        };
      const cause = (error as { cause?: { code?: string } }).cause;
      if (cause?.code === 'ECONNREFUSED') {
        return {
          ok: false,
          code: 'backend_offline',
          message: '本地服务未启动。',
        };
      }
      return { ok: false, code: 'http', message: '连接中断，请重试。' };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async transcribe(input, signal) {
      const result = await run(signal, async (combinedSignal) => {
        const response = await fetchImpl(`${baseUrl}/api/v1/voice/dictation`, {
          method: 'POST',
          headers: { 'content-type': input.mimeType },
          body: input.bytes.slice().buffer,
          signal: combinedSignal,
        });
        const body = await safeJson(response);
        if (!response.ok) return httpFailure(body);
        const text = (body as { text?: unknown } | null)?.text;
        if (typeof text !== 'string' || !text.trim()) {
          return {
            ok: false,
            code: 'invalid_response',
            message: '没有听清，请再说一次。',
          } satisfies VoiceFailure;
        }
        return { ok: true, text: text.trim() } as const;
      });
      return result;
    },

    async synthesize(input, signal) {
      const result = await run(signal, async (combinedSignal) => {
        const response = await fetchImpl(`${baseUrl}/api/v1/voice/speech`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: input.text.trim() }),
          signal: combinedSignal,
        });
        if (!response.ok) return httpFailure(await safeJson(response));
        const contentType =
          response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
        const declaredBytes = Number(response.headers.get('content-length'));
        if (
          contentType !== 'audio/mpeg' ||
          (Number.isFinite(declaredBytes) && declaredBytes > MAX_SPEECH_BYTES)
        ) {
          return {
            ok: false,
            code: 'invalid_response',
            message: '语音回答格式不正确。',
          } satisfies VoiceFailure;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_SPEECH_BYTES) {
          return {
            ok: false,
            code: 'invalid_response',
            message: '语音回答格式不正确。',
          } satisfies VoiceFailure;
        }
        return { ok: true, bytes, contentType: 'audio/mpeg' } as const;
      });
      return result;
    },
  };
}
