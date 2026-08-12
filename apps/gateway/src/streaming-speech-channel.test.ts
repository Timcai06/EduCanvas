import type {
  StreamingSpeechEvent,
  StreamingSpeechGateway,
  StreamingSpeechSession,
  StreamingSpeechTextInput,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import { STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS } from './streaming-transcription-quotas';
import { StreamingSpeechChannel } from './streaming-speech-channel';

class FakeSession implements StreamingSpeechSession {
  readonly pushed: StreamingSpeechTextInput[] = [];
  readonly finish = vi.fn();
  readonly cancel = vi.fn();
  private readonly values: StreamingSpeechEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private terminal = false;

  readonly events: AsyncIterable<StreamingSpeechEvent> = this.iterate();

  pushText(input: StreamingSpeechTextInput): void {
    this.pushed.push(input);
  }

  emit(event: StreamingSpeechEvent): void {
    this.values.push(event);
    if (event.type !== 'audio') this.terminal = true;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  private async *iterate(): AsyncIterable<StreamingSpeechEvent> {
    while (true) {
      while (this.values.length > 0) yield this.values.shift()!;
      if (this.terminal) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

describe('StreamingSpeechChannel', () => {
  it('在队列上限内顺序转发多段文本', async () => {
    const session = new FakeSession();
    const events: unknown[] = [];
    const audio: Array<{ sequence: number; bytes: Uint8Array }> = [];
    const release = vi.fn();
    const terminal = vi.fn();
    const channel = new StreamingSpeechChannel({
      gateway: {
        beginStreaming: vi.fn(() => session),
        streamSpeech: vi.fn(),
      },
      acquireSession: () => ({ released: false, release }),
      sendEvent: (event) => events.push(event),
      sendAudio: (sequence, bytes) => {
        audio.push({ sequence, bytes });
        return true;
      },
      onTerminal: terminal,
      createId: () => 'stable-id',
      quotas: {
        ...STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
        maxOutputBufferedBytes: 4,
      },
    });

    channel.receive({ type: 'speech.start', sequence: 0 });
    channel.receive({ type: 'speech.submit', sequence: 1, text: '第一句。' });

    expect(session.pushed).toEqual([{ sequence: 0, input: '第一句。' }]);

    session.emit({
      type: 'audio',
      sequence: 0,
      pcmBytes: Uint8Array.of(1, 2),
    });
    session.emit({
      type: 'audio',
      sequence: 1,
      pcmBytes: Uint8Array.of(3, 4),
    });
    await vi.waitFor(() => expect(audio).toHaveLength(2));

    session.emit({
      type: 'audio',
      sequence: 2,
      pcmBytes: Uint8Array.of(5, 6),
    });
    await vi.waitFor(() =>
      expect(events).toEqual([
        {
          type: 'speech.started',
          format: 'pcm_s16le',
          sampleRate: 24_000,
          channels: 1,
        },
        { type: 'speech.failed', failureCode: 'BACKPRESSURE_EXCEEDED' },
      ]),
    );
    expect(terminal).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('ACK 可释放已消费区间，允许后续帧继续写入', async () => {
    const session = new FakeSession();
    const events: unknown[] = [];
    const audio: Array<{ sequence: number; bytes: Uint8Array }> = [];
    const terminal = vi.fn();
    const release = vi.fn();
    const channel = new StreamingSpeechChannel({
      gateway: {
        beginStreaming: vi.fn(() => session),
        streamSpeech: vi.fn(),
      },
      acquireSession: () => ({ released: false, release }),
      sendEvent: (event) => events.push(event),
      sendAudio: (sequence, bytes) => {
        audio.push({ sequence, bytes });
        return true;
      },
      onTerminal: terminal,
      quotas: {
        ...STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
        maxOutputBufferedBytes: 4,
      },
    });

    channel.receive({ type: 'speech.start', sequence: 0 });
    session.emit({ type: 'audio', sequence: 0, pcmBytes: Uint8Array.of(1, 2) });
    session.emit({ type: 'audio', sequence: 1, pcmBytes: Uint8Array.of(3, 4) });
    await vi.waitFor(() => expect(audio).toHaveLength(2));

    channel.receive({ type: 'speech.ack', sequence: 1, audioSequence: 0 });
    channel.receive({ type: 'speech.ack', sequence: 2, audioSequence: 1 });
    await Promise.resolve();
    session.emit({ type: 'audio', sequence: 2, pcmBytes: Uint8Array.of(5, 6) });
    await vi.waitFor(() => expect(audio).toHaveLength(3));
    session.emit({ type: 'finished' });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(events).toEqual([
      {
        type: 'speech.started',
        format: 'pcm_s16le',
        sampleRate: 24_000,
        channels: 1,
      },
    ]);
    expect(terminal).toHaveBeenCalledTimes(0);
    channel.receive({ type: 'speech.ack', sequence: 3, audioSequence: 2 });
    expect(events.at(-1)).toEqual({ type: 'speech.finished' });
    expect(terminal).toHaveBeenCalledOnce();
  });

  it('拒绝重复或跳号 ACK', async () => {
    const session = new FakeSession();
    const events: unknown[] = [];
    const terminal = vi.fn();
    const channel = new StreamingSpeechChannel({
      gateway: {
        beginStreaming: vi.fn(() => session),
        streamSpeech: vi.fn(),
      },
      acquireSession: () => ({ released: false, release: vi.fn() }),
      sendEvent: (event) => events.push(event),
      sendAudio: () => true,
      onTerminal: terminal,
      quotas: {
        ...STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
        maxOutputBufferedBytes: 32,
      },
    });

    channel.receive({ type: 'speech.start', sequence: 0 });
    session.emit({ type: 'audio', sequence: 0, pcmBytes: Uint8Array.of(1, 2) });
    await vi.waitFor(() => expect(events).toHaveLength(1));

    channel.receive({ type: 'speech.ack', sequence: 1, audioSequence: 0 });
    expect(events[0]).toEqual({
      type: 'speech.started',
      format: 'pcm_s16le',
      sampleRate: 24_000,
      channels: 1,
    });

    channel.receive({ type: 'speech.ack', sequence: 2, audioSequence: 0 });
    await vi.waitFor(() =>
      expect(events).toEqual([
        {
          type: 'speech.started',
          format: 'pcm_s16le',
          sampleRate: 24_000,
          channels: 1,
        },
        {
          type: 'speech.failed',
          failureCode: 'INVALID_REQUEST',
        },
      ]),
    );
    expect(terminal).toHaveBeenCalledOnce();
  });

  it('socket 输出窗口拒绝帧时立即收敛为背压失败', async () => {
    const session = new FakeSession();
    const events: unknown[] = [];
    const terminal = vi.fn();
    const channel = new StreamingSpeechChannel({
      gateway: {
        beginStreaming: () => session,
        streamSpeech: vi.fn(),
      },
      acquireSession: () => ({ released: false, release: vi.fn() }),
      sendEvent: (event) => events.push(event),
      sendAudio: () => false,
      onTerminal: terminal,
    });
    channel.receive({ type: 'speech.start', sequence: 0 });
    session.emit({ type: 'audio', sequence: 0, pcmBytes: Uint8Array.of(1, 2) });
    await vi.waitFor(() => expect(terminal).toHaveBeenCalledOnce());
    expect(events.at(-1)).toEqual({
      type: 'speech.failed',
      failureCode: 'BACKPRESSURE_EXCEEDED',
    });
  });

  it('cancel 命令触发 CANCELLED 终态并幂等释放一次', () => {
    const session = new FakeSession();
    const events: unknown[] = [];
    const release = vi.fn();
    const terminal = vi.fn();
    const channel = new StreamingSpeechChannel({
      gateway: {
        beginStreaming: () => session,
        streamSpeech: vi.fn(),
      },
      acquireSession: () => ({ released: false, release }),
      sendEvent: (event) => events.push(event),
      sendAudio: () => true,
      onTerminal: terminal,
    });

    channel.receive({ type: 'speech.start', sequence: 0 });
    channel.receive({ type: 'speech.cancel', sequence: 1 });
    channel.disconnect();

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({
      type: 'speech.failed',
      failureCode: 'CANCELLED',
    });
    expect(release).toHaveBeenCalledOnce();
    expect(terminal).toHaveBeenCalledOnce();
  });
});
