import { describe, expect, it } from 'vitest';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import {
  answerRequest,
  collect,
  config,
  oneResponseFetch,
} from './openai-compatible-turn-model-gateway.test-support';
import { createTurnModelGatewayFromEnvironment } from './turn-model-gateway-factory';
import {
  contentFilteredChunks,
  createFixtureResponse,
  textStreamChunks,
} from './testing/openai-compatible-fixtures';

describe('OpenAI-compatible失败边界', () => {
  it('把外部AbortSignal归一化为aborted且不会抛出供应商异常', async () => {
    const external = new AbortController();
    const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => {
          const error = new Error('provider detail must stay internal');
          error.name = 'AbortError';
          reject(error);
        };
        if (init?.signal?.aborted === true) rejectAbort();
        else
          init?.signal?.addEventListener('abort', rejectAbort, { once: true });
      })) as typeof fetch;
    const gateway = new OpenAICompatibleTurnModelGateway(config, { fetchImpl });
    const pending = gateway
      .streamTurnText({ ...answerRequest, signal: external.signal })
      [Symbol.asyncIterator]()
      .next();
    external.abort();
    expect(await pending).toEqual({
      done: false,
      value: {
        type: 'failed',
        phase: 'answer',
        error: { code: 'aborted', retryable: false },
      },
    });
  });

  it('内部截止时间触发时归一化为可重试timeout', async () => {
    const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('timeout provider detail');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      })) as typeof fetch;
    const gateway = new OpenAICompatibleTurnModelGateway(
      { ...config, timeoutMs: 5 },
      { fetchImpl },
    );
    expect(await collect(gateway)).toEqual([
      {
        type: 'failed',
        phase: 'answer',
        error: { code: 'timeout', retryable: true },
      },
    ]);
  });

  it.each([
    {
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
      error: { code: 'rate_limit', retryable: true, retryAfterMs: 2_000 },
    },
    {
      status: 500,
      headers: new Headers(),
      error: { code: 'unavailable', retryable: true },
    },
    {
      status: 400,
      headers: new Headers(),
      error: { code: 'invalid_response', retryable: false },
    },
  ])(
    '安全映射HTTP $status且不暴露响应正文',
    async ({ status, headers, error }) => {
      const secret = 'provider-error-body-secret';
      const gateway = new OpenAICompatibleTurnModelGateway(config, {
        fetchImpl: oneResponseFetch(
          () => new Response(secret, { status, headers }),
        ),
        now: () => 1_000,
      });
      const events = await collect(gateway);
      expect(events).toEqual([{ type: 'failed', phase: 'answer', error }]);
      expect(JSON.stringify(events)).not.toContain(secret);
    },
  );

  it('content_filter保留usage并映射安全终态', async () => {
    const filtered = await collect(
      new OpenAICompatibleTurnModelGateway(config, {
        fetchImpl: oneResponseFetch(() =>
          createFixtureResponse(contentFilteredChunks),
        ),
      }),
    );
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toMatchObject({ type: 'usage' });
    expect(filtered[1]).toMatchObject({
      type: 'failed',
      error: { code: 'content_filtered', retryable: false },
      metadata: { finishReason: 'content_filter' },
    });
  });

  it('length保留usage并映射可重试不完整终态', async () => {
    const chunks = textStreamChunks.map((chunk) => {
      if (
        typeof chunk === 'object' &&
        chunk !== null &&
        'choices' in chunk &&
        Array.isArray(chunk.choices) &&
        chunk.choices[0]?.finish_reason === 'stop'
      ) {
        return {
          ...chunk,
          choices: [{ ...chunk.choices[0], finish_reason: 'length' }],
        };
      }
      return chunk;
    });
    const length = await collect(
      new OpenAICompatibleTurnModelGateway(config, {
        fetchImpl: oneResponseFetch(() => createFixtureResponse(chunks)),
      }),
    );
    expect(length.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'output_limit', retryable: true },
      metadata: { finishReason: 'length' },
    });
  });

  it.each([
    {
      name: 'malformed JSON',
      response: () =>
        new Response('data: {not-json}\n\ndata: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    },
    {
      name: 'missing DONE',
      response: () =>
        createFixtureResponse(textStreamChunks, { includeDone: false }),
    },
    {
      name: 'missing usage',
      response: () => createFixtureResponse(textStreamChunks.slice(0, -1)),
    },
    {
      name: 'changed response id',
      response: () =>
        createFixtureResponse([
          textStreamChunks[0],
          {
            ...(textStreamChunks[1] as Record<string, unknown>),
            id: 'different-response-id',
          },
          ...textStreamChunks.slice(2),
        ]),
    },
    {
      name: 'usage before finish reason',
      response: () => {
        const usageChunk = textStreamChunks.at(-1) as Record<string, unknown>;
        return createFixtureResponse([
          {
            ...(textStreamChunks[0] as Record<string, unknown>),
            usage: usageChunk.usage,
          },
          ...textStreamChunks.slice(1),
        ]);
      },
    },
  ])('把畸形SSE（$name）收敛为invalid_response', async ({ response }) => {
    const events = await collect(
      new OpenAICompatibleTurnModelGateway(config, {
        fetchImpl: oneResponseFetch(response),
      }),
    );
    expect(events.at(-1)).toEqual({
      type: 'failed',
      phase: 'answer',
      error: { code: 'invalid_response', retryable: false },
    });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });

  it('非event-stream响应释放body并安全失败', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {},
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
    const invalid = await collect(
      new OpenAICompatibleTurnModelGateway(config, {
        fetchImpl: oneResponseFetch(() => response),
      }),
    );
    expect(invalid.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'invalid_response', retryable: false },
    });
    expect(cancelled).toBe(true);
  });

  it('event-stream响应缺少body时安全失败', async () => {
    const missingBody = await collect(
      new OpenAICompatibleTurnModelGateway(config, {
        fetchImpl: oneResponseFetch(
          () =>
            new Response(null, {
              headers: { 'content-type': 'text/event-stream' },
            }),
        ),
      }),
    );
    expect(missingBody.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'invalid_response', retryable: false },
    });
  });

  it('未启用配置的组合根工厂返回null且不发起网络请求', () => {
    expect(
      createTurnModelGatewayFromEnvironment({
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
      }),
    ).toBeNull();
  });
});
