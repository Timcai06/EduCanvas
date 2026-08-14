import { describe, expect, it } from 'vitest';
import { createVoiceProxy } from '../src/main/voice-proxy';

const desktopSession = {
  version: 2 as const,
  token: `ecs1_${'t'.repeat(43)}`,
  expiresAt: '2026-09-10T08:00:00.000Z',
  webBaseUrl: 'https://learn.educanvas.example',
  gatewayBaseUrl: 'https://gateway.educanvas.example',
  userId: 'user:one',
  initialCursor: {
    notebookId: 'notebook:one',
    conversationId: 'conversation:one',
  },
};
const authenticated = {
  getSession: async () => desktopSession,
  invalidateSession: async () => undefined,
};

interface FetchCall {
  url: string;
  headers: Headers;
  body: BodyInit | null | undefined;
  signal: AbortSignal | null;
}

function fakeFetch(
  responder: (call: FetchCall) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const impl = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const call = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    return responder(call);
  };
  return { impl: impl as typeof fetch, calls };
}

describe('voice-proxy', () => {
  it('把 WebM 字节原样交给本地 dictation BFF 并只返回转写文本', async () => {
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]);
    const { impl, calls } = fakeFetch(
      () =>
        new Response(JSON.stringify({ text: '  帮我复习分数  ' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const proxy = createVoiceProxy({
      ...authenticated,
      fetchImpl: impl,
    });

    await expect(
      proxy.transcribe({ bytes, mimeType: 'audio/webm' }),
    ).resolves.toEqual({ ok: true, text: '帮我复习分数' });
    expect(calls[0]!.url).toBe(
      'https://learn.educanvas.example/api/v1/voice/dictation',
    );
    expect(calls[0]!.headers.get('content-type')).toBe('audio/webm');
    expect(calls[0]!.headers.get('authorization')).toBe(
      `Bearer ${desktopSession.token}`,
    );
    expect(new Uint8Array(calls[0]!.body as ArrayBuffer)).toEqual(bytes);
    expect(calls[0]!.headers.get('origin')).toBeNull();
  });

  it('返回受限的 MP3 字节，不向 renderer 暴露响应头或 Provider 内容', async () => {
    const mp3 = Uint8Array.from([0x49, 0x44, 0x33, 4]);
    const { impl, calls } = fakeFetch(
      () =>
        new Response(mp3.slice().buffer, {
          headers: { 'content-type': 'audio/mpeg', 'x-secret': 'provider' },
        }),
    );
    const proxy = createVoiceProxy({ ...authenticated, fetchImpl: impl });

    await expect(proxy.synthesize({ text: '答案是四。' })).resolves.toEqual({
      ok: true,
      bytes: mp3,
      contentType: 'audio/mpeg',
    });
    expect(calls[0]!.url).toContain('/api/v1/voice/speech');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ text: '答案是四。' });
  });

  it('HTTP 错误只映射稳定 code 和服务端安全文案', async () => {
    const { impl } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: '请先选择使用模式。' } }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    );
    const proxy = createVoiceProxy({ ...authenticated, fetchImpl: impl });

    await expect(proxy.synthesize({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'http',
      message: '请先选择使用模式。',
    });
  });

  it('用户取消会中止底层 fetch 并返回 aborted', async () => {
    const signals: AbortSignal[] = [];
    const { impl } = fakeFetch(({ signal }) => {
      if (signal) signals.push(signal);
      return new Promise(() => {});
    });
    const proxy = createVoiceProxy({ ...authenticated, fetchImpl: impl });
    const controller = new AbortController();

    const pending = proxy.transcribe(
      { bytes: Uint8Array.from([1]), mimeType: 'audio/webm' },
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'aborted',
    });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('代理超时与本地服务离线使用不同稳定错误', async () => {
    const timeoutFetch = fakeFetch(() => new Promise(() => {}));
    const timed = createVoiceProxy({
      ...authenticated,
      fetchImpl: timeoutFetch.impl,
      timeoutMs: 20,
    });
    await expect(timed.synthesize({ text: '你好' })).resolves.toMatchObject({
      ok: false,
      code: 'timeout',
    });

    const offlineFetch = fakeFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      });
    });
    const offline = createVoiceProxy({
      ...authenticated,
      fetchImpl: offlineFetch.impl,
    });
    await expect(offline.synthesize({ text: '你好' })).resolves.toMatchObject({
      ok: false,
      code: 'backend_offline',
    });
  });

  it('拒绝空 ASR 文本和伪造的音频响应', async () => {
    const emptyText = createVoiceProxy({
      ...authenticated,
      fetchImpl: fakeFetch(
        () => new Response(JSON.stringify({ text: '  ' }), { status: 200 }),
      ).impl,
    });
    await expect(
      emptyText.transcribe({
        bytes: Uint8Array.from([1]),
        mimeType: 'audio/webm',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_response' });

    const wrongAudio = createVoiceProxy({
      ...authenticated,
      fetchImpl: fakeFetch(
        () =>
          new Response(Uint8Array.from([1]).buffer, {
            headers: { 'content-type': 'text/plain' },
          }),
      ).impl,
    });
    await expect(
      wrongAudio.synthesize({ text: '你好' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid_response',
    });
  });

  it('在读取 chunked TTS 响应时立即拒绝超过 20 MiB 的内容', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20 * 1024 * 1024));
        controller.enqueue(Uint8Array.of(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const proxy = createVoiceProxy({
      ...authenticated,
      fetchImpl: fakeFetch(
        () =>
          new Response(body, {
            headers: { 'content-type': 'audio/mpeg' },
          }),
      ).impl,
    });

    await expect(
      proxy.synthesize({ text: '很长的回答' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid_response',
    });
    expect(cancelled).toBe(true);
  });

  it('没有桌面 session 时不发出语音请求', async () => {
    const { impl, calls } = fakeFetch(() => new Response());
    const proxy = createVoiceProxy({
      getSession: async () => null,
      invalidateSession: async () => undefined,
      fetchImpl: impl,
    });
    await expect(proxy.synthesize({ text: '你好' })).resolves.toMatchObject({
      ok: false,
      code: 'unauthenticated',
    });
    expect(calls).toHaveLength(0);
  });
});
