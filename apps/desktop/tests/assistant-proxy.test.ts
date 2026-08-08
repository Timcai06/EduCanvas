import { describe, expect, it } from 'vitest';
import { createAssistantProxy } from '../src/main/assistant-proxy';

/** 记录 fetch 调用（URL、headers、body、signal）并返回指定响应的 fake。 */
function fakeFetch(
  responder: (info: {
    url: string;
    headers: Headers;
    body: unknown;
    signal: AbortSignal | null;
  }) => Response | Promise<Response>,
) {
  const calls: Array<{
    url: string;
    origin: string | null;
    secFetchSite: string | null;
    body: unknown;
  }> = [];
  const impl = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      url: String(url),
      origin:
        (init?.headers as Record<string, string> | undefined)?.['origin'] ??
        null,
      secFetchSite:
        (init?.headers as Record<string, string> | undefined)?.[
          'sec-fetch-site'
        ] ?? null,
      body,
    });
    return responder({
      url: String(url),
      headers: new Headers(init?.headers),
      body,
      signal: init?.signal ?? null,
    });
  };
  return { impl: impl as typeof fetch, calls };
}

const okJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('assistant-proxy', () => {
  it('请求不带 Origin 与 sec-fetch-site 头（通过后端同源检查的无 Origin 分支）', async () => {
    const { impl, calls } = fakeFetch(() =>
      okJson({ action: 'unknown', message: 'hi' }),
    );
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
    });
    await proxy.turn({ text: '有哪些笔记本' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.origin).toBeNull();
    expect(calls[0]!.secFetchSite).toBeNull();
    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/assistant/turn');
  });

  it('每次调用生成新的 clientMessageId（幂等去重键）', async () => {
    const { impl, calls } = fakeFetch(() =>
      okJson({ action: 'unknown', message: 'ok' }),
    );
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
    });
    await proxy.turn({ text: 'a' });
    await proxy.turn({ text: 'b' });
    const [first, second] = calls.map(
      (c) => (c.body as { clientMessageId: string }).clientMessageId,
    );
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first).not.toBe(second);
  });

  it('ECONNREFUSED 映射为 backend_offline（本地服务未启动）', async () => {
    const { impl } = fakeFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      });
    });
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
    });
    const result = await proxy.turn({ text: 'hi' });
    expect(result).toMatchObject({ ok: false, code: 'backend_offline' });
  });

  it('HTTP 429/503 解析 error.message 文案', async () => {
    const { impl } = fakeFetch(() =>
      okJson(
        { error: { code: 'budget_exceeded', message: '今日额度已用完' } },
        429,
      ),
    );
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
    });
    const result = await proxy.turn({ text: 'hi' });
    expect(result).toMatchObject({
      ok: false,
      code: 'http',
      message: '今日额度已用完',
    });
  });

  it('超过 timeoutMs 映射为 timeout', async () => {
    const { impl } = fakeFetch(() => new Promise(() => {})); // 永不 resolve
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
      timeoutMs: 50,
    });
    const result = await proxy.turn({ text: 'hi' });
    expect(result).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('用户 signal 中止映射为 aborted，且信号透传给 fetch', async () => {
    const received: AbortSignal[] = [];
    const { impl } = fakeFetch(({ signal }) => {
      if (signal) received.push(signal);
      return new Promise(() => {});
    });
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
    });
    const ac = new AbortController();
    const pending = proxy.turn({ text: 'hi' }, ac.signal);
    ac.abort();
    const result = await pending;
    expect(received[0]?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'aborted' });
  });

  it('成功响应透传 action/message/artifactId/panel', async () => {
    const { impl } = fakeFetch(() =>
      okJson({
        action: 'open_artifact',
        message: '已打开',
        artifactId: 'art-1',
      }),
    );
    const proxy = createAssistantProxy({
      fetchImpl: impl,
      baseUrl: 'http://localhost:3000',
    });
    const result = await proxy.turn({ text: '打开宇宙导图' });
    expect(result).toEqual({
      ok: true,
      action: 'open_artifact',
      message: '已打开',
      artifactId: 'art-1',
    });
  });
});
