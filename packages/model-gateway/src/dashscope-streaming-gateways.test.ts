import { describe, expect, it } from 'vitest';
import type { StreamingTranscriptionEvent } from '@educanvas/agent-core';
import { DashScopeStreamingSpeechGateway } from './dashscope-streaming-speech-gateway';
import { DashScopeStreamingTranscriptionGateway } from './dashscope-streaming-transcription-gateway';
import type { DashScopeSocket } from './dashscope-websocket';

const configuration = {
  apiKey: 'not-exposed',
  workspaceId: 'ws-test',
  websocketUrl:
    'wss://ws-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
  asrModel: 'paraformer-realtime-v2',
  ttsModel: 'cosyvoice-v3-flash',
  voice: 'longanyang',
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
      parameters: { format: 'pcm', sample_rate: 16000 },
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

  it('CosyVoice 只输出有序 PCM 与 finished，不投影原始事件', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of gateway.streamSpeech({
        taskAlias: 'speech.synthesize',
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

  it('CosyVoice 遇到非法文本帧时收敛为稳定失败', async () => {
    const socket = new FakeSocket();
    const gateway = new DashScopeStreamingSpeechGateway({
      configuration,
      socketFactory: () => socket,
    });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of gateway.streamSpeech({
        taskAlias: 'speech.synthesize',
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
