import type {
  StreamAgentTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import type { EnabledModelGatewayConfiguration } from './config';
import {
  createTurnModelGatewayFromEnvironment,
  OpenAICompatibleTurnModelGateway,
} from './openai-compatible-turn-model-gateway';
import {
  contentFilteredChunks,
  createFixtureResponse,
  textStreamChunks,
  toolStreamChunks,
} from './testing/openai-compatible-fixtures';

const config: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'local',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'fixture-key-never-real',
  modelIds: { primary: 'explicitly-configured-model' },
  timeoutMs: 1_000,
  maxOutputTokens: 2_048,
};

const answerRequest: StreamAgentTextRequest = {
  taskAlias: 'teaching.turn',
  modelAlias: 'primary',
  phase: 'answer',
  messages: [
    { role: 'system', content: '你是AI老师。' },
    { role: 'user', content: '猫和狗有什么不同？' },
  ],
  tools: [
    {
      name: 'getStudentState',
      description: '读取学生当前学习状态',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  toolResults: [],
  promptVersion: 'teaching-turn-v1',
  traceId: 'trace-fixture-1',
  turnId: 'turn-fixture-1',
};

const collect = async (
  gateway: OpenAICompatibleTurnModelGateway,
  request: StreamAgentTextRequest = answerRequest,
): Promise<TurnModelEvent[]> => {
  const events: TurnModelEvent[] = [];
  for await (const event of gateway.streamTurnText(request)) events.push(event);
  return events;
};

const oneResponseFetch = (
  responseFactory: () => Response,
  capture?: (input: URL | RequestInfo, init?: RequestInit) => void,
): typeof fetch =>
  (async (input: URL | RequestInfo, init?: RequestInit) => {
    capture?.(input, init);
    return responseFactory();
  }) as typeof fetch;

describe('OpenAICompatibleTurnModelGateway', () => {
  it('严格映射文本、usage和完成元数据且绝不转发reasoning_content', async () => {
    let capturedInput: URL | RequestInfo | undefined;
    let capturedInit: RequestInit | undefined;
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(
        () => createFixtureResponse(textStreamChunks, { splitEvery: 7 }),
        (input, init) => {
          capturedInput = input;
          capturedInit = init;
        },
      ),
      now: () => 100,
    });

    const events = await collect(gateway);

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'text_delta',
      'usage',
      'completed',
    ]);
    expect(events.slice(0, 2)).toEqual([
      { type: 'text_delta', phase: 'answer', delta: '猫和' },
      {
        type: 'text_delta',
        phase: 'answer',
        delta: '狗可以从耳朵等特征区分。',
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      metadata: {
        providerResponseId: 'fixture-response-id',
        provider: 'deepseek',
        taskAlias: 'teaching.turn',
        modelAlias: 'primary',
        resolvedModelId: 'explicitly-configured-model',
        modelRevision: 'configured-provider-model',
        systemFingerprint: 'fixture-fingerprint',
        finishReason: 'stop',
        usage: {
          inputTokens: 24,
          outputTokens: 9,
          cacheHitTokens: 4,
          reasoningTokens: 3,
        },
        latencyMs: 0,
        traceId: 'trace-fixture-1',
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      'fixture-private-reasoning-never-forward',
    );
    expect(JSON.stringify(events)).not.toContain(config.apiKey);

    expect(String(capturedInput)).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe(
      `Bearer ${config.apiKey}`,
    );
    const body = JSON.parse(String(capturedInit?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: 'explicitly-configured-model',
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 2_048,
      tool_choice: 'auto',
      thinking: { type: 'disabled' },
    });
    expect(JSON.stringify(body)).not.toContain('reasoning_content');
    expect(body).not.toHaveProperty('user_id');
  });

  it('接受DeepSeek在终止choice中内联usage的SSE布局', async () => {
    const finishChunk = textStreamChunks.at(-2) as Record<string, unknown>;
    const usageChunk = textStreamChunks.at(-1) as Record<string, unknown>;
    const deepSeekChunks = [
      ...textStreamChunks.slice(0, -2),
      { ...finishChunk, usage: usageChunk.usage },
    ];
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() =>
        createFixtureResponse(deepSeekChunks, { splitEvery: 9 }),
      ),
    });

    const events = await collect(gateway);

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'text_delta',
      'usage',
      'completed',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      metadata: {
        resolvedModelId: 'explicitly-configured-model',
        finishReason: 'stop',
        usage: { inputTokens: 24, outputTokens: 9 },
      },
    });
  });

  it('在供应商终止事件到达前立即交付首个文本增量', async () => {
    const encoder = new TextEncoder();
    let releaseRemaining!: () => void;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(textStreamChunks[0])}\r\n\r\n`,
            ),
          );
          releaseRemaining = () => {
            for (const chunk of textStreamChunks.slice(1)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`),
              );
            }
            controller.enqueue(encoder.encode('data: [DONE]\r\n\r\n'));
            controller.close();
          };
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() => response),
    });
    const iterator = gateway
      .streamTurnText(answerRequest)
      [Symbol.asyncIterator]();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      iterator.next(),
      new Promise<'timed-out'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timed-out'), 200);
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    expect(first).not.toBe('timed-out');
    expect(first).toMatchObject({
      done: false,
      value: { type: 'text_delta', delta: '猫和' },
    });
    releaseRemaining();
    const remainder: TurnModelEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      remainder.push(next.value);
    }
    expect(remainder.at(-1)?.type).toBe('completed');
  });

  it('按索引累积工具参数并在finish_reason后显式关闭调用', async () => {
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() =>
        createFixtureResponse(toolStreamChunks, { splitEvery: 11 }),
      ),
    });

    const events = await collect(gateway);

    expect(events).toEqual([
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'call_state_1',
        tool: 'getStudentState',
        argumentsDelta: '{',
        done: false,
      },
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'call_state_1',
        tool: 'getStudentState',
        argumentsDelta: '}',
        done: false,
      },
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'call_state_1',
        tool: 'getStudentState',
        argumentsDelta: '',
        done: true,
      },
      {
        type: 'usage',
        phase: 'answer',
        usage: {
          inputTokens: 18,
          outputTokens: 6,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
      },
      expect.objectContaining({
        type: 'completed',
        phase: 'answer',
        metadata: expect.objectContaining({ finishReason: 'tool_calls' }),
      }),
    ]);
  });

  it('synthesis请求由自包含toolResults重建assistant.tool_calls和tool消息', async () => {
    let capturedBody: unknown;
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(
        () => createFixtureResponse(textStreamChunks),
        (_input, init) => {
          capturedBody = JSON.parse(String(init?.body));
        },
      ),
    });
    const request: StreamAgentTextRequest = {
      ...answerRequest,
      phase: 'synthesis',
      tools: [],
      toolResults: [
        {
          callId: 'call_state_1',
          tool: 'getStudentState',
          arguments: {},
          output: { state: 'EXPLAIN' },
        },
      ],
    };

    const events = await collect(gateway, request);

    expect(events.at(-1)?.type).toBe('completed');
    expect(capturedBody).toMatchObject({
      tool_choice: 'none',
      messages: [
        { role: 'system', content: '你是AI老师。' },
        { role: 'user', content: '猫和狗有什么不同？' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_state_1',
              type: 'function',
              function: { name: 'getStudentState', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_state_1',
          content: '{"state":"EXPLAIN"}',
        },
      ],
    });
    expect(capturedBody).not.toHaveProperty('tools');
  });

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
    const iterator = gateway.streamTurnText({
      ...answerRequest,
      signal: external.signal,
    });
    const pending = iterator[Symbol.asyncIterator]().next();

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

  it('content_filter保留已核算usage并以安全错误终止', async () => {
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() =>
        createFixtureResponse(contentFilteredChunks),
      ),
    });

    const events = await collect(gateway);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'usage' });
    expect(events[1]).toMatchObject({
      type: 'failed',
      error: { code: 'content_filtered', retryable: false },
      metadata: { finishReason: 'content_filter' },
    });
  });

  it('length保留已核算usage但以可重试的不完整错误终止', async () => {
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
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() => createFixtureResponse(chunks)),
    });

    const events = await collect(gateway);
    expect(events.at(-1)).toMatchObject({
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
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(response),
    });

    const events = await collect(gateway);

    expect(events.at(-1)).toEqual({
      type: 'failed',
      phase: 'answer',
      error: { code: 'invalid_response', retryable: false },
    });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });

  it('响应不是event-stream时取消非空body并安全失败', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          // 保持流未结束，确保cancel是适配器的显式资源释放。
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() => response),
    });

    expect(await collect(gateway)).toEqual([
      {
        type: 'failed',
        phase: 'answer',
        error: { code: 'invalid_response', retryable: false },
      },
    ]);
    expect(cancelled).toBe(true);
  });

  it('event-stream成功响应缺少body时安全失败', async () => {
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(
        () =>
          new Response(null, {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    });

    expect(await collect(gateway)).toEqual([
      {
        type: 'failed',
        phase: 'answer',
        error: { code: 'invalid_response', retryable: false },
      },
    ]);
  });

  it('未启用配置的组合根工厂返回null且不发起网络请求', () => {
    expect(
      createTurnModelGatewayFromEnvironment({
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
      }),
    ).toBeNull();
  });
});
