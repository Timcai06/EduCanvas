import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { DashScopeStreamingSpeechGateway } from './dashscope-streaming-speech-gateway';
import { DashScopeStreamingTranscriptionGateway } from './dashscope-streaming-transcription-gateway';
import type {
  DashScopeSocket,
  DashScopeSocketFactory,
} from './dashscope-websocket';
import { dashScopeFailureCode } from './dashscope-protocol';

const secret = 'SECRET_KEY_BODY_URL_PROMPT_STACK';
const configuration = {
  apiKey: secret,
  workspaceId: 'fixture',
  websocketUrl: `wss://provider.invalid/${secret}`,
  asrModel: 'asr',
  dictationModel: 'dictation',
  ttsModel: 'tts',
  voice: 'voice',
};
class Socket implements DashScopeSocket {
  readyState = 1;
  sent: Array<string | Uint8Array> = [];
  private listeners = new Map<string, Array<(...args: any[]) => void>>();
  on(event: string, listener: (...args: any[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit('close');
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
  get taskId(): string {
    return JSON.parse(this.sent[0] as string).header.task_id;
  }
}
const cases = [
  {
    name: 'streaming_speech',
    begin: (
      socket: Socket,
      signal?: AbortSignal,
      socketFactory: DashScopeSocketFactory = () => socket,
    ) =>
      new DashScopeStreamingSpeechGateway({
        configuration,
        socketFactory,
      }).beginStreaming({
        taskAlias: 'speech.generate',
        modelAlias: 'speech',
        operationId: 'fixture',
        traceId: 'fixture',
        signal,
      }),
  },
  {
    name: 'streaming_transcription',
    begin: (
      socket: Socket,
      signal?: AbortSignal,
      socketFactory: DashScopeSocketFactory = () => socket,
    ) =>
      new DashScopeStreamingTranscriptionGateway({
        configuration,
        socketFactory,
      }).beginStreaming({
        operationId: 'fixture',
        segmentId: 'fixture',
        traceId: 'fixture',
        signal,
      }),
  },
];
async function collect(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
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
  vi.useRealTimers();
});

describe.each(cases)(
  '$name production failure diagnostics',
  ({ name, begin }) => {
    it('factory sync throw is normalized without reading or preserving sensitive fields', () => {
      const error = new Error('fixture');
      const readers = [
        'message',
        'stack',
        'body',
        'responseBody',
        'url',
        'prompt',
        'apiKey',
      ].map((property) => {
        const reader = vi.fn(() => {
          throw new Error('forbidden sensitive getter');
        });
        Object.defineProperty(error, property, { get: reader });
        return reader;
      });
      const factory = vi.fn<DashScopeSocketFactory>(() => {
        throw error;
      });
      let thrown: unknown;
      try {
        begin(new Socket(), undefined, factory);
      } catch (failure) {
        thrown = failure;
      }
      expect(thrown).toBeInstanceOf(ModelGatewayInvocationError);
      expect((thrown as ModelGatewayInvocationError).normalized).toEqual({
        code: 'unavailable',
        retryable: true,
      });
      expect(thrown).not.toBe(error);
      expect(thrown).not.toHaveProperty('cause');
      expect(factory).toHaveBeenCalledTimes(1);
      for (const reader of readers) expect(reader).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(log()).toMatchObject({
        event: 'provider_unavailable',
        provider: 'dashscope',
        capability: name,
        stage: 'provider_call',
      });
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        secret,
      );
      expect(console.error).not.toHaveBeenCalled();
    });

    it('pre-aborted requests keep CANCELLED session semantics without calling the factory', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      controller.abort(secret);
      const factory = vi.fn<DashScopeSocketFactory>(() => {
        throw new Error(secret);
      });
      const session = begin(new Socket(), controller.signal, factory);
      expect(factory).not.toHaveBeenCalled();
      expect(await collect(session.events)).toEqual([
        expect.objectContaining({ type: 'failed', failureCode: 'CANCELLED' }),
      ]);
      session.cancel();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(log()).toMatchObject({
        event: 'provider_aborted',
        failureClass: 'cancelled',
        stage: 'precondition',
        retryable: false,
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        secret,
      );
    });

    it('cancellation during a throwing factory wins over construction failure', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const factory = vi.fn<DashScopeSocketFactory>(() => {
        controller.abort(secret);
        throw new Error(secret);
      });
      const session = begin(new Socket(), controller.signal, factory);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(await collect(session.events)).toEqual([
        expect.objectContaining({ type: 'failed', failureCode: 'CANCELLED' }),
      ]);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(log()).toMatchObject({
        event: 'provider_aborted',
        failureClass: 'cancelled',
        stage: 'precondition',
        retryable: false,
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        secret,
      );
    });

    it.each(['INVALID_API_KEY', secret])(
      'parsed task-failed code %s uses a closed whitelist and emits once',
      async (code) => {
        const socket = new Socket();
        const session = begin(socket);
        socket.emit('open');
        const frame = JSON.stringify({
          header: {
            task_id: socket.taskId,
            event: 'task-failed',
            error_code: code,
            error_message: secret,
          },
          payload: { private: secret },
        });
        socket.emit('message', frame, false);
        socket.emit('error', new Error(secret));
        socket.emit('message', frame, false);
        socket.emit('close');
        const events = await collect(session.events);
        expect(events).toEqual([
          expect.objectContaining({
            type: 'failed',
            failureCode: 'MODEL_FAILED',
          }),
        ]);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(log()).toMatchObject({
          provider: 'dashscope',
          capability: name,
          stage: 'stream',
          event: 'provider_unavailable',
        });
        if (code === 'INVALID_API_KEY')
          expect(log()).toHaveProperty('providerErrorCode', code);
        else expect(log()).not.toHaveProperty('providerErrorCode');
        expect(JSON.stringify(events)).not.toContain('INVALID_API_KEY');
        expect(JSON.stringify(events)).not.toContain(secret);
        expect(
          JSON.stringify(vi.mocked(console.warn).mock.calls),
        ).not.toContain(secret);
        expect(console.error).not.toHaveBeenCalled();
      },
    );

    it('malformed frame is response_invalid and does not repeat on close', async () => {
      const socket = new Socket();
      const session = begin(socket);
      socket.emit('open');
      socket.emit('message', secret, false);
      socket.emit('close');
      const events = await collect(session.events);
      expect(events).toEqual([
        expect.objectContaining({
          type: 'failed',
          failureCode: 'MODEL_FAILED',
        }),
      ]);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(log()).toMatchObject({
        event: 'provider_invalid_response',
        failureClass: 'response_invalid',
      });
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        secret,
      );
    });

    it('socket error logs only normalized transport fields', async () => {
      const socket = new Socket();
      const session = begin(socket);
      const error = new Error(secret);
      for (const property of ['message', 'stack', 'body', 'url'])
        Object.defineProperty(error, property, {
          get: () => {
            throw new Error('forbidden sensitive property');
          },
        });
      socket.emit('error', error);
      socket.emit('close');
      await collect(session.events);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(log()).toMatchObject({
        event: 'provider_unavailable',
        failureClass: 'provider_failure',
        capability: name,
      });
      expect(console.error).not.toHaveBeenCalled();
    });

    it('cancel remains CANCELLED and has a distinct single diagnostic', async () => {
      const socket = new Socket();
      const session = begin(socket);
      session.cancel();
      session.cancel();
      socket.emit('close');
      expect(await collect(session.events)).toEqual([
        expect.objectContaining({ type: 'failed', failureCode: 'CANCELLED' }),
      ]);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(log()).toMatchObject({
        event: 'provider_aborted',
        failureClass: 'cancelled',
        retryable: false,
      });
    });
  },
);

it('speech timeout has one production timeout diagnostic', async () => {
  vi.useFakeTimers();
  const session = cases[0]!.begin(new Socket());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await collect(session.events)).toEqual([
    expect.objectContaining({ type: 'failed', failureCode: 'MODEL_FAILED' }),
  ]);
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(log()).toMatchObject({
    event: 'provider_timeout',
    normalizedCode: 'timeout',
    retryable: true,
  });
});

it('DashScope short uppercase secrets are not treated as stable error codes', () => {
  expect(
    dashScopeFailureCode({
      header: {
        task_id: '00000000-0000-4000-8000-000000000000',
        event: 'task-failed',
        error_code: secret,
      },
    }),
  ).toBe('UNKNOWN');
});
