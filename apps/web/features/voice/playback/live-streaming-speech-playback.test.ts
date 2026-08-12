import type {
  LiveSpeechSessionClient,
  StreamingSpeechClientHandlers,
} from '../transport';
import { describe, expect, it, vi } from 'vitest';
import { LiveStreamingSpeechPlayback } from './live-streaming-speech-playback';
import type { SubtitleDurationClock } from './subtitle-clock/recovery';
import type { LiveSpeechPcmPlayer } from './stream-speech-into-player';

function harness(durationClock?: SubtitleDurationClock) {
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
    durationClock,
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
    test
      .handlers()
      .onAudio({ sequence: 0, pcmBytes: Uint8Array.of(1, 2) }, vi.fn());
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
    after
      .handlers()
      .onAudio({ sequence: 0, pcmBytes: Uint8Array.of(1, 2) }, vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    after.handlers().onFailed('CONNECTION_LOST');
    expect(after.failed).toHaveBeenCalledWith(false);
  });

  it('只有 enqueue 成功才触发音频消费回调', async () => {
    const consumed = vi.fn();
    const enqueue = vi.fn<LiveSpeechPcmPlayer['enqueue']>().mockResolvedValue({
      startAt: 10,
      endAt: 11,
      durationSeconds: 1,
    });
    const player: LiveSpeechPcmPlayer = { enqueue };
    let handlers: StreamingSpeechClientHandlers | null = null;
    const playbackMarkers: Array<() => void> = [];
    const playback = new LiveStreamingSpeechPlayback({
      notebookId: 'nb-1',
      player,
      signal: new AbortController().signal,
      createClient: (nextHandlers) => {
        handlers = nextHandlers;
        return {
          start: vi.fn().mockResolvedValue(undefined),
          submit: vi.fn(),
          finish: vi.fn(),
          cancel: vi.fn(),
        };
      },
      onMarker: (_at, callback) => playbackMarkers.push(callback),
      onSubtitle: () => undefined,
      onPlayedCursor: () => undefined,
      onFirstAudio: vi.fn(),
      onAudioLevel: vi.fn(),
      onFinished: vi.fn(),
      onFailed: vi.fn(),
    });
    await playback.start();
    handlers!.onAudio({ sequence: 0, pcmBytes: Uint8Array.of(1, 2) }, consumed);
    await Promise.resolve();
    await Promise.resolve();
    expect(consumed).not.toHaveBeenCalled();
    playbackMarkers.forEach((callback) => callback());
    expect(consumed).toHaveBeenCalledOnce();

    enqueue.mockResolvedValue(null);
    handlers!.onAudio({ sequence: 1, pcmBytes: Uint8Array.of(3, 4) }, consumed);
    await Promise.resolve();
    await Promise.resolve();
    expect(consumed).toHaveBeenCalledOnce();
  });

  it('完成一轮后用实际累计 PCM 校准下一轮字幕估算', async () => {
    const durationClock: SubtitleDurationClock = {
      getScaleFactor: vi.fn(() => 1),
      observe: vi.fn(),
      reset: vi.fn(),
    };
    const test = harness(durationClock);
    test.playback.submit({ text: '你好。', startCursor: 0, endCursor: 3 });
    test
      .handlers()
      .onAudio({ sequence: 0, pcmBytes: Uint8Array.of(1, 2) }, vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    test.handlers().onFinished();
    await Promise.resolve();
    await Promise.resolve();
    expect(durationClock.observe).toHaveBeenCalledWith(1, expect.any(Number));
  });
});
