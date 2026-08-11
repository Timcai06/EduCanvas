import { randomUUID } from 'node:crypto';
import type {
  StreamingSpeechEvent,
  StreamingSpeechGateway,
  StreamingSpeechRequest,
} from '@educanvas/agent-core';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';
import {
  copyDashScopeBinaryFrame,
  parseDashScopeEnvelope,
} from './dashscope-protocol';
import {
  createDashScopeSocket,
  type DashScopeSocketFactory,
} from './dashscope-websocket';

export interface DashScopeStreamingSpeechGatewayOptions {
  configuration: DashScopeSpeechConfiguration;
  socketFactory?: DashScopeSocketFactory;
}

const MAX_QUEUED_AUDIO_BYTES = 2 * 1024 * 1024;
const SPEECH_TASK_TIMEOUT_MS = 60_000;

export class DashScopeStreamingSpeechGateway implements StreamingSpeechGateway {
  constructor(
    private readonly options: DashScopeStreamingSpeechGatewayOptions,
  ) {}

  async *streamSpeech(
    request: StreamingSpeechRequest,
  ): AsyncIterable<StreamingSpeechEvent> {
    const input = request.input.trim();
    if (!input || [...input].length > 20_000) {
      yield { type: 'failed', failureCode: 'MODEL_FAILED' };
      return;
    }
    const taskId = randomUUID();
    const socket = (this.options.socketFactory ?? createDashScopeSocket)(
      this.options.configuration,
    );
    const queue: StreamingSpeechEvent[] = [];
    const waiters: Array<() => void> = [];
    let terminal = false;
    let sequence = 0;
    let queuedAudioBytes = 0;
    const wake = () => waiters.splice(0).forEach((resolve) => resolve());
    const fail = (failureCode: 'MODEL_FAILED' | 'CANCELLED') => {
      if (terminal) return;
      terminal = true;
      queue.push({ type: 'failed', failureCode });
      wake();
    };
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'tts',
            function: 'SpeechSynthesizer',
            model: this.options.configuration.ttsModel,
            parameters: {
              text_type: 'PlainText',
              voice: this.options.configuration.voice,
              format: 'pcm',
              sample_rate: 24000,
            },
            input: {},
          },
        }),
      );
    });
    socket.on('message', (data: unknown, isBinary?: boolean) => {
      if (terminal) return;
      if (isBinary) {
        const bytes = copyDashScopeBinaryFrame(data);
        if (
          bytes === null ||
          queuedAudioBytes + bytes.byteLength > MAX_QUEUED_AUDIO_BYTES
        ) {
          fail('MODEL_FAILED');
          socket.close();
          return;
        }
        queuedAudioBytes += bytes.byteLength;
        queue.push({ type: 'audio', sequence: sequence++, pcmBytes: bytes });
        wake();
        return;
      }
      const body = parseDashScopeEnvelope(data);
      if (body === null) {
        fail('MODEL_FAILED');
        socket.close();
        return;
      }
      if (body.header.task_id !== taskId) return;
      if (body.header.event === 'task-started') {
        socket.send(
          JSON.stringify({
            header: {
              action: 'continue-task',
              task_id: taskId,
              streaming: 'duplex',
            },
            payload: { input: { text: input } },
          }),
        );
        socket.send(
          JSON.stringify({
            header: {
              action: 'finish-task',
              task_id: taskId,
              streaming: 'duplex',
            },
            payload: { input: {} },
          }),
        );
      } else if (body.header.event === 'task-finished') {
        terminal = true;
        queue.push({ type: 'finished' });
        wake();
        socket.close();
      } else if (body.header.event === 'task-failed') {
        fail('MODEL_FAILED');
      }
    });
    socket.on('error', () => fail('MODEL_FAILED'));
    socket.on('close', () => {
      if (!terminal) fail('MODEL_FAILED');
    });
    const abort = () => {
      fail('CANCELLED');
      socket.close();
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    const timeout = setTimeout(() => {
      fail('MODEL_FAILED');
      socket.close();
    }, SPEECH_TASK_TIMEOUT_MS);
    timeout.unref?.();

    try {
      while (true) {
        while (queue.length) {
          const event = queue.shift()!;
          if (event.type === 'audio') {
            queuedAudioBytes -= event.pcmBytes.byteLength;
          }
          yield event;
        }
        if (terminal) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
      socket.close();
    }
  }
}
