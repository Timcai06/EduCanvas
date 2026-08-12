import type {
  LiveSpeechSessionClient,
  StreamingSpeechClientHandlers,
} from '../transport';
import { describe, expect, it, vi } from 'vitest';
import { LiveStreamingSpeechPlayback } from './live-streaming-speech-playback';

function harness() {
  let handlers: StreamingSpeechClientHandlers | null = null;
  const client: LiveSpeechSessionClient = {
    start: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn(),
  };
  const markers: Array<{ at: number; callback: () => void }> = [];
  const subtitles: string[] = [];
  const played: number[] = [];
  const finished = vi.fn();
  const failed = vi.fn();
  const playback = new LiveStreamingSpeechPlayback({
    notebookId: 'nb-1',
    player: {
      enqueue: vi.fn().mockResolvedValue({
        startAt: 10,
        endAt: 11,
        durationSeconds: 1,
      }),
    },
    signal: new AbortController().signal,
    createClient: (nextHandlers) => {
      handlers = nextHandlers;
      return client;
    },
    onMarker: (at, callback) => markers.push({ at, callback }),
    onSubtitle: (text) => subtitles.push(text),
    onPlayedCursor: (cursor) => played.push(cursor),
    onFirstAudio: vi.fn(),
    onAudioLevel: vi.fn(),
    onFinished: finished,
    onFailed: failed,
  });
  return {
    playback,
    client,
    handlers: () => handlers!,
    markers,
    subtitles,
    played,
    finished,
    failed,
  };
}

describe('LiveStreamingSpeechPlayback', () => {
  it('增量提交文本，但把 PCM 和字幕维持在同一播放时间轴', async () => {
    const test = harness();
    await test.playback.start();
    test.playback.submit({ text: '你好。', startCursor: 0, endCursor: 3 });
    test.playback.submit({ text: '继续。', startCursor: 3, endCursor: 6 });
    test.playback.finish();
    expect(test.client.submit).toHaveBeenCalledTimes(2);
    expect(test.client.finish).toHaveBeenCalledOnce();
    test.handlers().onAudio({ sequence: 0, pcmBytes: Uint8Array.of(1, 2) });
    await Promise.resolve();
    await Promise.resolve();
    test.markers.forEach((marker) => marker.callback());
    expect(test.subtitles[0]).toBe('你好。');
    test.handlers().onFinished();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.finished).toHaveBeenCalledOnce();
  });

  it('首个 PCM 前失败才允许上层回退，之后失败必须抑制重播', async () => {
    const before = harness();
    before.handlers().onFailed('CONNECTION_LOST');
    expect(before.failed).toHaveBeenCalledWith(true);

    const after = harness();
    after.handlers().onAudio({ sequence: 0, pcmBytes: Uint8Array.of(1, 2) });
    await Promise.resolve();
    await Promise.resolve();
    after.handlers().onFailed('CONNECTION_LOST');
    expect(after.failed).toHaveBeenCalledWith(false);
  });
});
