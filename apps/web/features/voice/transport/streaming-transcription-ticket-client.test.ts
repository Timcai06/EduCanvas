import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  STREAMING_TRANSCRIPTION_TICKET_ENDPOINT,
  StreamingTranscriptionTicketError,
  createStreamingTranscriptionTicketClient,
  isValidTicketEndpoint,
  type StreamingTranscriptionTicketClient,
  type StreamingTranscriptionTicketClientOptions,
} from './streaming-transcription-ticket-client';

const TICKET = 'ticket-secret-value-123';
const BEARER = 'bearer-secret-value-456';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 记录请求的 fake fetch：调用参数可断言，绝不把凭证放进 URL。 */
function stubFetch(response: Response) {
  const impl = vi.fn<typeof fetch>().mockResolvedValue(response);
  return impl;
}

function createClient(
  options: Omit<StreamingTranscriptionTicketClientOptions, 'fetchImpl'> & {
    response: Response;
  },
): {
  client: StreamingTranscriptionTicketClient;
  fetchImpl: ReturnType<typeof stubFetch>;
  logs: { label: string; code?: string }[];
} {
  const fetchImpl = stubFetch(options.response);
  const logs: { label: string; code?: string }[] = [];
  const client = createStreamingTranscriptionTicketClient({
    ...options,
    fetchImpl,
    log: (entry) => logs.push(entry),
  });
  return { client, fetchImpl, logs };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streaming-transcription-ticket-client', () => {
  it('POST 固定端点换取 ticket：只带 notebookId，Authorization 只在此请求出现', async () => {
    const { client, fetchImpl } = createClient({
      response: jsonResponse(
        { ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' },
        201,
      ),
      bearer: BEARER,
    });
    const grant = await client.requestTicket({ notebookId: 'nb-123' });

    expect(grant.ticket).toBe(TICKET);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(STREAMING_TRANSCRIPTION_TICKET_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
    });
    expect(JSON.parse(String(init?.body))).toEqual({ notebookId: 'nb-123' });
    expect(String(url)).not.toContain(TICKET);
  });

  it('ticket 不进入 URL（endpoint 固定路径，无 query）', async () => {
    const { client, fetchImpl } = createClient({
      response: jsonResponse(
        { ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' },
        201,
      ),
    });
    await client.requestTicket({ notebookId: 'nb-123' });
    const url = fetchImpl.mock.calls[0]![0];
    // endpoint 路径本身含 "tickets" 字样；ticket 值是响应体内容，绝不进 URL。
    expect(String(url)).not.toContain(TICKET);
    expect(String(url)).not.toContain('?');
  });

  it('HTTP 失败抛 HTTP_ERROR；服务端稳定 error code 单独携带', async () => {
    const { client } = createClient({
      response: jsonResponse(
        { error: { code: 'STREAMING_TRANSCRIPTION_UNAVAILABLE' } },
        503,
      ),
    });
    const failure = await client.requestTicket({ notebookId: 'nb-123' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StreamingTranscriptionTicketError);
    const ticketError = failure as StreamingTranscriptionTicketError;
    expect(ticketError.code).toBe('HTTP_ERROR');
    expect(ticketError.serverCode).toBe('STREAMING_TRANSCRIPTION_UNAVAILABLE');
    // 稳定错误面不携带响应体。
    expect(ticketError.message).not.toContain('STREAMING_TRANSCRIPTION');
  });

  it('网络错误抛 NETWORK_ERROR', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    const client = createStreamingTranscriptionTicketClient({
      fetchImpl,
      endpoint: STREAMING_TRANSCRIPTION_TICKET_ENDPOINT,
    });
    const failure = await client.requestTicket({ notebookId: 'nb-123' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect((failure as StreamingTranscriptionTicketError).code).toBe(
      'NETWORK_ERROR',
    );
  });

  it('201 但响应形状非法抛 INVALID_RESPONSE', async () => {
    const { client } = createClient({
      response: jsonResponse({ ticket: 42 }, 201),
    });
    const failure = await client.requestTicket({ notebookId: 'nb-123' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect((failure as StreamingTranscriptionTicketError).code).toBe(
      'INVALID_RESPONSE',
    );
  });

  it('额外响应键被 strict schema 拒绝', async () => {
    const { client } = createClient({
      response: jsonResponse(
        {
          ticket: TICKET,
          expiresAt: '2026-08-06T00:00:00.000Z',
          userId: 'leak',
        },
        201,
      ),
    });
    const failure = await client.requestTicket({ notebookId: 'nb-123' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect((failure as StreamingTranscriptionTicketError).code).toBe(
      'INVALID_RESPONSE',
    );
  });

  it('本地拒绝明显非法的 notebookId，不发起凭证请求', async () => {
    const { client, fetchImpl } = createClient({
      response: jsonResponse(
        { ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' },
        201,
      ),
    });
    const failure = await client
      .requestTicket({ notebookId: '../../etc/passwd' })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as StreamingTranscriptionTicketError).code).toBe(
      'INVALID_RESPONSE',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('bearer 支持惰性提供器，且只在请求头消费一次', async () => {
    const bearerProvider = vi.fn().mockReturnValue(BEARER);
    const { client, fetchImpl } = createClient({
      response: jsonResponse(
        { ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' },
        201,
      ),
      bearer: bearerProvider,
    });
    await client.requestTicket({ notebookId: 'nb-123' });
    expect(bearerProvider).toHaveBeenCalledTimes(1);
    const headers = fetchImpl.mock.calls[0]![1]?.headers;
    expect(headers).toMatchObject({ authorization: `Bearer ${BEARER}` });
  });

  it('AbortSignal 透传给 fetch', async () => {
    const controller = new AbortController();
    const { client, fetchImpl } = createClient({
      response: jsonResponse(
        { ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' },
        201,
      ),
    });
    await client.requestTicket({
      notebookId: 'nb-123',
      signal: controller.signal,
    });
    expect(fetchImpl.mock.calls[0]![1]?.signal).toBe(controller.signal);
  });

  it('日志不含 ticket 与 bearer', async () => {
    const { client, logs } = createClient({
      response: jsonResponse(
        { ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' },
        201,
      ),
      bearer: BEARER,
    });
    await client.requestTicket({ notebookId: 'nb-123' });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(TICKET);
    expect(serialized).not.toContain(BEARER);
    expect(serialized).not.toContain('nb-123');
  });

  it('失败路径日志只有稳定 code，不含响应体', async () => {
    const { client, logs } = createClient({
      response: jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401),
      bearer: BEARER,
    });
    await client.requestTicket({ notebookId: 'nb-123' }).catch(() => undefined);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(BEARER);
    expect(serialized).not.toContain('UNAUTHENTICATED');
  });

  it('绝对 URL endpoint 在构造时拒绝（bearer 只允许同源相对路径）', () => {
    expect(() =>
      createStreamingTranscriptionTicketClient({
        endpoint:
          'https://attacker.invalid/v1/client/streaming-transcription/tickets',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createStreamingTranscriptionTicketClient({
        endpoint:
          '//attacker.invalid/v1/client/streaming-transcription/tickets',
      }),
    ).toThrow(TypeError);
  });

  it('同源相对路径 endpoint 合法（含默认 Gateway 路径）', () => {
    expect(
      isValidTicketEndpoint('/v1/client/streaming-transcription/tickets'),
    ).toBe(true);
    expect(
      isValidTicketEndpoint('/api/v1/streaming-transcription/tickets'),
    ).toBe(true);
    expect(isValidTicketEndpoint('https://gateway.invalid/v1/tickets')).toBe(
      false,
    );
    expect(isValidTicketEndpoint('//evil.example/v1/tickets')).toBe(false);
  });
});
