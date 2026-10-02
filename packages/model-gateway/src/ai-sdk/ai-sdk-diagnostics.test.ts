import type {
  StreamAgentTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSdkTurnModelGateway } from './ai-sdk-turn-model-gateway';
import { answerRequest } from '../openai-compatible-turn-model-gateway.test-support';

type StreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>;
type StreamPart =
  StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
const secret = 'SECRET_BODY_PROMPT_KEY_URL_STACK';
const modelWith = (chunks: StreamPart[]) =>
  new MockLanguageModelV3({
    doStream: { stream: simulateReadableStream<StreamPart>({ chunks }) },
  });
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function gatewayFor(modelFactory: () => MockLanguageModelV3) {
  return new AiSdkTurnModelGateway({
    provider: 'openai-compatible',
    modelIds: { primary: 'fixture' },
    timeoutMs: 1_000,
    maxOutputTokens: 100,
    modelFactory,
  });
}
async function collect(
  gateway: AiSdkTurnModelGateway,
  request: StreamAgentTextRequest = answerRequest,
) {
  const events: TurnModelEvent[] = [];
  for await (const event of gateway.streamTurnText(request)) events.push(event);
  return events;
}
function apiError(
  status: number,
  code: unknown = 'context_length_exceeded',
  type: unknown = 'invalid_request_error',
) {
  const parsed = { code, type };
  Object.defineProperty(parsed, 'message', {
    get: () => {
      throw new Error('forbidden parsed message');
    },
  });
  const error = new APICallError({
    message: secret,
    url: `https://provider.invalid/${secret}`,
    requestBodyValues: { secret },
    responseBody: secret,
    statusCode: status,
    isRetryable: false,
    data: { error: parsed },
  });
  for (const property of [
    'responseBody',
    'url',
    'requestBodyValues',
    'stack',
  ]) {
    Object.defineProperty(error, property, {
      get: () => {
        throw new Error('forbidden sensitive property');
      },
    });
  }
  return error;
}
const log = () => JSON.parse(vi.mocked(console.warn).mock.calls[0]![0]);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(['doStream rejection', 'stream error part'])(
  '%s diagnostics',
  (channel) => {
    it.each([400, 422, 401, 403])(
      'keeps trusted HTTP %s status in production without SDK raw logging',
      async (status) => {
        const error = apiError(status);
        const model =
          channel === 'doStream rejection'
            ? new MockLanguageModelV3({
                doStream: async () => {
                  throw error;
                },
              })
            : modelWith([
                { type: 'stream-start', warnings: [] },
                { type: 'error', error },
              ]);
        const events = await collect(gatewayFor(() => model));
        expect(events.at(-1)).toEqual({
          type: 'failed',
          phase: 'answer',
          error: {
            code:
              status === 400 || status === 422
                ? 'invalid_response'
                : 'unavailable',
            retryable: false,
          },
        });
        expect(events.filter((event) => event.type === 'failed')).toHaveLength(
          1,
        );
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(log()).toMatchObject({
          event:
            status === 400 || status === 422
              ? 'provider_request_rejected'
              : 'provider_unauthorized',
          status,
          capability: 'turn',
          providerErrorCode: 'context_length_exceeded',
          providerErrorType: 'invalid_request_error',
        });
        expect(console.error).not.toHaveBeenCalled();
        expect(
          JSON.stringify(vi.mocked(console.warn).mock.calls),
        ).not.toContain(secret);
        expect(JSON.stringify(events)).not.toContain(secret);
      },
    );
  },
);

it.each([
  secret,
  'x'.repeat(1_000),
  'invalid_request_error\nprivate',
  400,
  { code: 'invalid_api_key' },
])('does not forward unknown parsed identifier %j', async (candidate) => {
  const error = apiError(400, candidate, candidate);
  await collect(gatewayFor(() => modelWith([{ type: 'error', error }])));
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(log()).not.toHaveProperty('providerErrorCode');
  expect(log()).not.toHaveProperty('providerErrorType');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    secret,
  );
  expect(console.error).not.toHaveBeenCalled();
});

it('request projection failure is distinct and never creates a model', async () => {
  const modelFactory = vi.fn();
  const events = await collect(gatewayFor(modelFactory), {
    ...answerRequest,
    phase: 'synthesis',
    toolResults: [],
  });
  expect(modelFactory).not.toHaveBeenCalled();
  expect(events).toEqual([
    {
      type: 'failed',
      phase: 'synthesis',
      error: { code: 'invalid_response', retryable: false },
    },
  ]);
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(log()).toMatchObject({
    event: 'provider_request_build_failed',
    failureClass: 'request_build_failed',
    stage: 'request_build',
  });
});

it.each(['length', 'content-filter', 'other'] as const)(
  'finish failure %s has one production diagnostic',
  async (reason) => {
    const events = await collect(
      gatewayFor(() =>
        modelWith([
          { type: 'stream-start', warnings: [] },
          {
            type: 'finish',
            finishReason: { unified: reason, raw: reason },
            usage,
          },
        ]),
      ),
    );
    expect(events.at(-1)?.type).toBe('failed');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(log()).toMatchObject({ capability: 'turn', stage: 'stream' });
  },
);

it('malformed provider output is internally classified as response failure', async () => {
  const events = await collect(
    gatewayFor(() =>
      modelWith([
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: 'x'.repeat(600) },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
        },
      ]),
    ),
  );
  expect(events.at(-1)).toEqual({
    type: 'failed',
    phase: 'answer',
    error: { code: 'invalid_response', retryable: false },
  });
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(log()).toMatchObject({
    event: 'provider_invalid_response',
    failureClass: 'response_invalid',
  });
});

it('successful stream has no failure diagnostics', async () => {
  const events = await collect(
    gatewayFor(() =>
      modelWith([
        { type: 'stream-start', warnings: [] },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
        },
      ]),
    ),
  );
  expect(events.at(-1)?.type).toBe('completed');
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});
