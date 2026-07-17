const responseId = 'fixture-response-id';
const model = 'configured-provider-model';
const fingerprint = 'fixture-fingerprint';

const baseChunk = {
  id: responseId,
  created: 1_786_000_000,
  model,
  object: 'chat.completion.chunk',
  system_fingerprint: fingerprint,
  usage: null,
};

export const textStreamChunks: readonly unknown[] = [
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '猫和' },
        finish_reason: null,
      },
    ],
  },
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {
          content: null,
          reasoning_content: 'fixture-private-reasoning-never-forward',
        },
        finish_reason: null,
      },
    ],
  },
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: { content: '狗可以从耳朵等特征区分。' },
        finish_reason: null,
      },
    ],
  },
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
  },
  {
    ...baseChunk,
    choices: [],
    usage: {
      prompt_tokens: 24,
      completion_tokens: 9,
      total_tokens: 33,
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 20,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  },
];

export const toolStreamChunks: readonly unknown[] = [
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_state_1',
              type: 'function',
              function: { name: 'getStudentState', arguments: '{' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      },
    ],
  },
  {
    ...baseChunk,
    choices: [],
    usage: {
      prompt_tokens: 18,
      completion_tokens: 6,
      total_tokens: 24,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 18,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
];

export const contentFilteredChunks: readonly unknown[] = [
  {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'content_filter',
      },
    ],
  },
  {
    ...baseChunk,
    choices: [],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 0,
      total_tokens: 8,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 8,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
];

export interface FixtureResponseOptions {
  splitEvery?: number;
  includeDone?: boolean;
  status?: number;
  headers?: HeadersInit;
}

/** 把官方 data-only SSE 形状切成任意网络分片，防止测试依赖行边界。 */
export function createFixtureResponse(
  chunks: readonly unknown[],
  options: FixtureResponseOptions = {},
): Response {
  const source = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`),
    ...(options.includeDone === false ? [] : ['data: [DONE]\r\n\r\n']),
  ].join('');
  const bytes = new TextEncoder().encode(source);
  const splitEvery = options.splitEvery ?? bytes.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += splitEvery) {
        controller.enqueue(bytes.slice(offset, offset + splitEvery));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      ...options.headers,
    },
  });
}
