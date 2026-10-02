import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import { OpenAICompatibleStructuredModelGateway } from './openai-compatible-structured-model-gateway';
import { OpenAICompatibleEmbeddingModelGateway } from './openai-compatible-embedding-model-gateway';
import { OpenAICompatibleImageGenerationModelGateway } from './openai-compatible-image-generation-model-gateway';
import { OpenAICompatibleSpeechModelGateway } from './openai-compatible-speech-model-gateway';
import { OpenAICompatibleAudioTranscriptionModelGateway } from './openai-compatible-audio-transcription-model-gateway';
import { DashScopeSpeechModelGateway } from './dashscope-speech-model-gateway';
import { DashScopeAudioTranscriptionModelGateway } from './dashscope-audio-transcription-model-gateway';
import {
  answerRequest,
  collect,
  config,
} from './openai-compatible-turn-model-gateway.test-support';
import {
  contentFilteredChunks,
  createFixtureResponse,
  textStreamChunks,
} from './testing/openai-compatible-fixtures';

const secret = 'SECRET_KEY_PROMPT_BODY_URL_STACK';
const configuration = {
  ...config,
  apiKey: secret,
  baseUrl: `https://provider.invalid/${secret}`,
  modelIds: {
    primary: 'text',
    structured: 'structured',
    embedding: 'embedding',
    image: 'image',
    speech: 'speech',
    transcription: 'transcription',
  },
  embeddingModelVersion: 'v1',
};
const dashscope = {
  apiKey: secret,
  workspaceId: 'fixture',
  websocketUrl: `wss://provider.invalid/${secret}`,
  asrModel: 'asr',
  dictationModel: 'dictation',
  ttsModel: 'tts',
  voice: 'voice',
};
const common = {
  promptVersion: 'fixture',
  traceId: 'fixture',
  operationId: 'fixture',
};
const speech = {
  ...common,
  taskAlias: 'speech.generate' as const,
  modelAlias: 'speech' as const,
  input: secret,
  format: 'mp3' as const,
};
const transcription = {
  ...common,
  taskAlias: 'audio.transcribe' as const,
  modelAlias: 'transcription' as const,
  audioBytes: Uint8Array.of(1, 2),
  mimeType: 'audio/wav' as const,
};
const structured = {
  ...common,
  taskAlias: 'artifact.generate' as const,
  modelAlias: 'structured' as const,
  messages: [{ role: 'user' as const, content: secret }],
  schema: z.object({ answer: z.string() }),
};

const adapters = [
  {
    name: 'native Turn',
    capability: 'turn',
    run: async (fetchImpl: typeof fetch) =>
      (
        await collect(
          new OpenAICompatibleTurnModelGateway(configuration, { fetchImpl }),
          { ...answerRequest, messages: [{ role: 'user', content: secret }] },
        )
      ).find((event) => event.type === 'failed')?.error,
  },
  {
    name: 'structured',
    capability: 'structured',
    run: (fetchImpl: typeof fetch) =>
      new OpenAICompatibleStructuredModelGateway(configuration, {
        fetchImpl,
      }).generateStructured(structured),
  },
  {
    name: 'embedding',
    capability: 'embedding',
    run: (fetchImpl: typeof fetch) =>
      new OpenAICompatibleEmbeddingModelGateway(configuration, {
        fetchImpl,
      }).embed({
        ...common,
        taskAlias: 'retrieval.embed',
        modelAlias: 'embedding',
        purpose: 'passage',
        inputs: [secret],
      }),
  },
  {
    name: 'image',
    capability: 'image',
    run: (fetchImpl: typeof fetch) =>
      new OpenAICompatibleImageGenerationModelGateway(configuration, {
        fetchImpl,
      }).generateImage({
        ...common,
        taskAlias: 'image.generate',
        modelAlias: 'image',
        prompt: secret,
        size: '1024x1024',
        count: 1,
      }),
  },
  {
    name: 'OpenAI speech',
    capability: 'speech',
    run: (fetchImpl: typeof fetch) =>
      new OpenAICompatibleSpeechModelGateway(configuration, {
        fetchImpl,
      }).generateSpeech(speech),
  },
  {
    name: 'OpenAI transcription',
    capability: 'transcription',
    run: (fetchImpl: typeof fetch) =>
      new OpenAICompatibleAudioTranscriptionModelGateway(configuration, {
        fetchImpl,
      }).transcribeAudio(transcription),
  },
  {
    name: 'DashScope speech',
    capability: 'speech',
    run: (fetchImpl: typeof fetch) =>
      new DashScopeSpeechModelGateway(dashscope, { fetchImpl }).generateSpeech(
        speech,
      ),
  },
  {
    name: 'DashScope transcription',
    capability: 'transcription',
    run: (fetchImpl: typeof fetch) =>
      new DashScopeAudioTranscriptionModelGateway(dashscope, {
        fetchImpl,
      }).transcribeAudio(transcription),
  },
];

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ModelGatewayInvocationError);
    return (error as ModelGatewayInvocationError).normalized;
  }
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(adapters)(
  '$name production diagnostics',
  ({ capability, run }) => {
    it.each([400, 422])(
      'HTTP %s keeps public contract and never reads rejected body',
      async (status) => {
        const response = new Response(secret, { status });
        for (const property of ['text', 'json', 'arrayBuffer', 'clone']) {
          Object.defineProperty(response, property, {
            get: () => {
              throw new Error('forbidden body access');
            },
          });
        }
        const reader = vi
          .spyOn(response.body!, 'getReader')
          .mockImplementation(() => {
            throw new Error('forbidden body reader');
          });
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
        expect(await failure(() => run(fetchImpl))).toEqual({
          code: 'invalid_response',
          retryable: false,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(reader).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(
          JSON.parse(vi.mocked(console.warn).mock.calls[0]![0]),
        ).toMatchObject({
          event: 'provider_request_rejected',
          failureClass: 'request_rejected',
          capability,
          status,
          retryable: false,
        });
        expect(
          JSON.stringify(vi.mocked(console.warn).mock.calls),
        ).not.toContain(secret);
        expect(console.error).not.toHaveBeenCalled();
      },
    );

    it('malformed successful response has a distinct terminal diagnostic', async () => {
      const result = await failure(() =>
        run(
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(Response.json({ private: secret })),
        ),
      );
      expect(result).toMatchObject({ code: 'invalid_response' });
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(vi.mocked(console.warn).mock.calls[0]![0]),
      ).toMatchObject({
        event: 'provider_invalid_response',
        failureClass: 'response_invalid',
        capability,
        status: 200,
      });
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        secret,
      );
    });

    it('transport exception is logged once without inspecting sensitive error fields', async () => {
      const error = new Error('fixture');
      for (const property of ['message', 'stack', 'body', 'url']) {
        Object.defineProperty(error, property, {
          get: () => {
            throw new Error('forbidden error access');
          },
        });
      }
      const result = await failure(() =>
        run(vi.fn<typeof fetch>().mockRejectedValue(error)),
      );
      expect(result).toEqual({ code: 'unavailable', retryable: true });
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(vi.mocked(console.warn).mock.calls[0]![0]),
      ).toMatchObject({
        event: 'provider_unavailable',
        failureClass: 'provider_failure',
        capability,
        stage: 'provider_call',
      });
      expect(console.error).not.toHaveBeenCalled();
    });
  },
);

it('native Turn request construction failure is internal and never calls fetch', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const events = await collect(
    new OpenAICompatibleTurnModelGateway(configuration, { fetchImpl }),
    { ...answerRequest, phase: 'synthesis', toolResults: [] },
  );
  expect(events).toEqual([
    {
      type: 'failed',
      phase: 'synthesis',
      error: { code: 'invalid_response', retryable: false },
    },
  ]);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0])).toMatchObject({
    event: 'provider_request_build_failed',
    failureClass: 'request_build_failed',
  });
});

it('native finish failure emits a single diagnostic while successful streams stay quiet', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(createFixtureResponse(contentFilteredChunks))
    .mockResolvedValueOnce(createFixtureResponse(textStreamChunks));
  const gateway = new OpenAICompatibleTurnModelGateway(configuration, {
    fetchImpl,
  });
  expect((await collect(gateway)).at(-1)).toMatchObject({
    type: 'failed',
    error: { code: 'content_filtered', retryable: false },
  });
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0])).toMatchObject({
    event: 'provider_content_filtered',
    capability: 'turn',
    stage: 'response_parse',
  });
  expect((await collect(gateway)).at(-1)?.type).toBe('completed');
  expect(console.warn).toHaveBeenCalledTimes(1);
});

it('unsupported structured schema fails safely before calling fetch', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const gateway = new OpenAICompatibleStructuredModelGateway(configuration, {
    fetchImpl,
  });
  expect(
    await failure(() =>
      gateway.generateStructured({
        ...structured,
        schema: z.custom(() => true),
      }),
    ),
  ).toEqual({ code: 'invalid_response', retryable: false });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0])).toMatchObject({
    event: 'provider_request_build_failed',
    capability: 'structured',
    stage: 'request_build',
  });
});

it('DashScope audio download rejection retains stage and omits signed URL', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        output: {
          finish_reason: 'stop',
          audio: {
            url: `https://fixture.oss-cn-beijing.aliyuncs.com/${secret}`,
          },
        },
      }),
    )
    .mockResolvedValueOnce(new Response(secret, { status: 403 }));
  await failure(() =>
    new DashScopeSpeechModelGateway(dashscope, { fetchImpl }).generateSpeech(
      speech,
    ),
  );
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0])).toMatchObject({
    event: 'provider_unauthorized',
    provider: 'dashscope',
    stage: 'audio_download',
    status: 403,
  });
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    secret,
  );
});
