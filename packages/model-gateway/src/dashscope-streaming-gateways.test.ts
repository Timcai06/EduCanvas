import { describe, expect, it } from 'vitest';
import type { StreamingTranscriptionEvent } from '@educanvas/agent-core';
import { DashScopeStreamingSpeechGateway } from './dashscope-streaming-speech-gateway';
import { DashScopeStreamingTranscriptionGateway } from './dashscope-streaming-transcription-gateway';
import { dashScopeFailureCode } from './dashscope-protocol';
import type { DashScopeSocket } from './dashscope-websocket';

const configuration = {
  apiKey: 'not-exposed',
  workspaceId: 'ws-test',
  websocketUrl:
    'wss://ws-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
  asrModel: 'paraformer-realtime-v2',
  dictationModel: 'qwen3-asr-flash',
  ttsModel: 'qwen-audio-3.0-tts-flash',
  voice: 'longanhuan_v3.6',
};

class FakeSocket implements DashScopeSocket {
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
  close(): void {}
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function serverEvent(
  taskId: string,
  event: string,
  payload: unknown = {},
): string {
  return JSON.stringify({ header: { task_id: taskId, event }, payload });
}

describe('DashScope streaming adapters', () => {
  it('只暴露白名单形状的供应商失败码', () => {
    expect(
      dashScopeFailureCode({
        header: {
          task_id: '00000000-0000-4000-8000-000000000000',
          event: 'task-failed',
          error_code: 'INVALID_API_KEY',
          error_message: 'secret response body',
        },
      }),
    ).toBe('INVALID_API_KEY');
    expect(
      dashScopeFailureCode({
        header: {
          task_id: '00000000-0000-4000-8000-000000000000',
          event: 'task-failed',
          error_code: 'bad response body',
        },
      }),
    ).toBe('UNKNOWN');
  });

  it('Paraformer 将 partial/sentence_end 归一化为 partial/endpoint/final 且 final 唯一', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingTranscriptionGateway({
      configuration,
      socketFactory: () => socket,
    });
    const session = gateway.beginStreaming({
      operationId: 'op-1',
      segmentId: 'seg-1',
      traceId: 'trace-1',
    });
    socket.emit('open');
    const run = JSON.parse(socket.sent[0] as string);
    const taskId = run.header.task_id as string;
    expect(run.payload).toMatchObject({
      model: 'paraformer-realtime-v2',
      parameters: { format: 'pcm', sample_rate: 16000, heartbeat: true },
    });
    session.pushChunk({
      operationId: 'op-1',
      segmentId: 'seg-1',
      sequence: 0,
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm_s16le',
      pcmBytes: Uint8Array.from([0, 0]),
    });
    socket.emit('message', serverEvent(taskId, 'task-started'), false);
    expect(socket.sent.some((value) => value instanceof Uint8Array)).toBe(true);
    socket.emit(
      'message',
      serverEvent(taskId, 'result-generated', {
        output: {
          sentence: { text: '你好', sentence_end: false, heartbeat: false },
        },
      }),
      false,
    );
    socket.emit(
      'message',
      serverEvent(taskId, 'result-generated', {
        output: {
          sentence: {
            text: '你好世界。',
            sentence_end: true,
            heartbeat: false,
          },
        },
      }),
      false,
    );
    const events: StreamingTranscriptionEvent[] = [];
    for await (const event of session.events) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'partial',
      'endpoint',
      'final',
    ]);
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1);
    expect(
      socket.sent
        .filter((value): value is string => typeof value === 'string')
        .map((value) => JSON.parse(value).header.action),
    ).toEqual(['run-task', 'finish-task']);
    expect(JSON.stringify(events)).not.toContain(configuration.apiKey);
  });

  it('Paraformer 拒绝畸形 Provider 结果并只产生稳定失败事件', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingTranscriptionGateway({
      configuration,
      socketFactory: () => socket,
    });
    const session = gateway.beginStreaming({
      operationId: 'op-malformed',
      segmentId: 'seg-malformed',
      traceId: 'trace-malformed',
    });
    socket.emit('open');
    const taskId = JSON.parse(socket.sent[0] as string).header
      .task_id as string;
    socket.emit('message', serverEvent(taskId, 'task-started'), false);
    socket.emit(
      'message',
      serverEvent(taskId, 'result-generated', {
        output: { sentence: { text: 42, sentence_end: true } },
      }),
      false,
    );

    const events: StreamingTranscriptionEvent[] = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([
      expect.objectContaining({ type: 'failed', failureCode: 'MODEL_FAILED' }),
    ]);
    expect(JSON.stringify(events)).not.toContain('42');
  });

  it('DashScope TTS 只输出有序 PCM 与 finished，不投影原始事件', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of gateway.streamSpeech({
        taskAlias: 'speech.generate',
        modelAlias: 'speech',
        input: '你好。',
        operationId: 'op-1',
        traceId: 'trace-1',
      }))
        events.push(event);
      return events;
    })();
    await Promise.resolve();
    socket.emit('open');
    const run = JSON.parse(socket.sent[0] as string);
    expect(run.payload).toMatchObject({
      model: 'qwen-audio-3.0-tts-flash',
      parameters: {
        voice: 'longanhuan_v3.6',
        format: 'pcm',
        sample_rate: 24_000,
      },
    });
    const taskId = run.header.task_id as string;
    socket.emit('message', serverEvent(taskId, 'task-started'), false);
    expect(JSON.parse(socket.sent[1] as string).payload.input.text).toBe(
      '你好。',
    );
    socket.emit('message', Uint8Array.from([1, 2, 3, 4]), true);
    socket.emit('message', serverEvent(taskId, 'task-finished'), false);
    const events = await eventsPromise;
    expect(events).toEqual([
      { type: 'audio', sequence: 0, pcmBytes: Uint8Array.from([1, 2, 3, 4]) },
      { type: 'finished' },
    ]);
  });

  it('DashScope TTS 在同一 task 内按序提交多个语义段并只 finish 一次', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const session = gateway.beginStreaming({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      operationId: 'op-continuous',
      traceId: 'trace-continuous',
    });
    session.pushText({ sequence: 0, input: '第一句。' });
    session.pushText({ sequence: 1, input: '第二句。' });
    session.finish();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of session.events) events.push(event);
      return events;
    })();

    socket.emit('open');
    const taskId = JSON.parse(socket.sent[0] as string).header
      .task_id as string;
    socket.emit('message', serverEvent(taskId, 'task-started'), false);
    const commands = socket.sent.map((raw) => JSON.parse(raw as string));
    expect(commands.map((command) => command.header.action)).toEqual([
      'run-task',
      'continue-task',
      'continue-task',
      'finish-task',
    ]);
    expect(
      commands.slice(1, 3).map((command) => command.payload.input.text),
    ).toEqual(['第一句。', '第二句。']);
    socket.emit('message', Uint8Array.from([1, 2]), true);
    socket.emit('message', Uint8Array.from([3, 4]), true);
    socket.emit('message', serverEvent(taskId, 'task-finished'), false);
    await expect(eventsPromise).resolves.toEqual([
      { type: 'audio', sequence: 0, pcmBytes: Uint8Array.from([1, 2]) },
      { type: 'audio', sequence: 1, pcmBytes: Uint8Array.from([3, 4]) },
      { type: 'finished' },
    ]);
  });

  it('DashScope TTS cancel 发送 Provider cancel 且忽略迟到事件', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const session = gateway.beginStreaming({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      operationId: 'op-cancel',
      traceId: 'trace-cancel',
    });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of session.events) events.push(event);
      return events;
    })();

    socket.emit('open');
    const taskId = JSON.parse(socket.sent[0] as string).header
      .task_id as string;
    socket.emit('message', serverEvent(taskId, 'task-started'), false);
    session.pushText({ sequence: 0, input: '这句话会被取消。' });
    session.cancel();
    session.cancel();
    socket.emit('message', Uint8Array.from([1, 2]), true);
    socket.emit('message', serverEvent(taskId, 'task-finished'), false);

    const commands = socket.sent.map((raw) => JSON.parse(raw as string));
    expect(commands.map((command) => command.header.action)).toEqual([
      'run-task',
      'continue-task',
      'finish-task',
    ]);
    const cancel = commands.at(-1);
    expect(cancel).toMatchObject({
      header: {
        action: 'finish-task',
        task_id: taskId,
        streaming: 'duplex',
      },
      payload: { input: { directive: 'cancel' } },
    });
    await expect(eventsPromise).resolves.toEqual([
      { type: 'failed', failureCode: 'CANCELLED' },
    ]);
  });

  it('DashScope TTS 拒绝跳号输入与奇数 PCM，并保持唯一终态', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const session = gateway.beginStreaming({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      operationId: 'op-invalid-sequence',
      traceId: 'trace-invalid-sequence',
    });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of session.events) events.push(event);
      return events;
    })();
    session.pushText({ sequence: 1, input: '跳号。' });
    session.finish();
    await expect(eventsPromise).resolves.toEqual([
      { type: 'failed', failureCode: 'MODEL_FAILED' },
    ]);
  });

  it('DashScope TTS 遇到非法文本帧时收敛为稳定失败', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of gateway.streamSpeech({
        taskAlias: 'speech.generate',
        modelAlias: 'speech',
        input: '你好。',
        operationId: 'op-invalid',
        traceId: 'trace-invalid',
      }))
        events.push(event);
      return events;
    })();
    await Promise.resolve();
    socket.emit('open');
    socket.emit('message', '{not-json', false);

    await expect(eventsPromise).resolves.toEqual([
      { type: 'failed', failureCode: 'MODEL_FAILED' },
    ]);
  });
});
