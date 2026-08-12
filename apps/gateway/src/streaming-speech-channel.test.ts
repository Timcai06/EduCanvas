import type {
  StreamingSpeechEvent,
  StreamingSpeechGateway,
  StreamingSpeechSession,
  StreamingSpeechTextInput,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
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
  it('把一条连接内的多个文本段投影为一个 provider session', async () => {
    const session = new FakeSession();
    const events: unknown[] = [];
    const audio: Array<{ sequence: number; bytes: Uint8Array }> = [];
    const release = vi.fn();
    const terminal = vi.fn();
    const gateway: StreamingSpeechGateway = {
      beginStreaming: vi.fn(() => session),
      streamSpeech: vi.fn(),
    };
    const channel = new StreamingSpeechChannel({
      gateway,
      acquireSession: () => ({ released: false, release }),
      sendEvent: (event) => events.push(event),
      sendAudio: (sequence, bytes) => {
        audio.push({ sequence, bytes });
        return true;
      },
      onTerminal: terminal,
      createId: () => 'stable-id',
    });

    channel.receive({ type: 'speech.start', sequence: 0 });
    channel.receive({ type: 'speech.submit', sequence: 1, text: '第一句。' });
    channel.receive({ type: 'speech.submit', sequence: 2, text: '第二句。' });
    channel.receive({ type: 'speech.finish', sequence: 3 });
    expect(session.pushed).toEqual([
      { sequence: 0, input: '第一句。' },
      { sequence: 1, input: '第二句。' },
    ]);
    expect(session.finish).toHaveBeenCalledOnce();
    session.emit({ type: 'audio', sequence: 0, pcmBytes: Uint8Array.of(1, 2) });
    session.emit({ type: 'finished' });
    await vi.waitFor(() => expect(terminal).toHaveBeenCalledOnce());
    expect(audio).toEqual([{ sequence: 0, bytes: Uint8Array.from([1, 2]) }]);
    expect(events).toEqual([
      {
        type: 'speech.started',
        format: 'pcm_s16le',
        sampleRate: 24_000,
        channels: 1,
      },
      { type: 'speech.finished' },
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('拒绝跳号并只释放一次 session lease', async () => {
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
    channel.receive({ type: 'speech.finish', sequence: 2 });
    channel.disconnect();
    await Promise.resolve();
    expect(session.cancel).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({
      type: 'speech.failed',
      failureCode: 'INVALID_REQUEST',
    });
    expect(release).toHaveBeenCalledOnce();
    expect(terminal).toHaveBeenCalledOnce();
  });
});
