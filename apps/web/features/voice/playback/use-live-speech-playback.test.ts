import { describe, expect, it, vi } from 'vitest';
import type { LiveSubtitleCue } from './live-speech-text';
import {
  reduceLiveSpeechPlayback,
  streamSpeechIntoPlayer,
  type LiveSpeechPcmPlayer,
} from './use-live-speech-playback';

describe('reduceLiveSpeechPlayback', () => {
  it('播放结束和插话会原子清空最后一句字幕', () => {
    const started = reduceLiveSpeechPlayback(
      { phase: 'idle', subtitle: null, playbackFailed: false },
      { type: 'start' },
    );
    const speaking = reduceLiveSpeechPlayback(started, {
      type: 'cue',
      text: '这是最后一句。',
    });

    expect(reduceLiveSpeechPlayback(speaking, { type: 'finish' })).toEqual({
      phase: 'idle',
      subtitle: null,
      playbackFailed: false,
    });
    expect(reduceLiveSpeechPlayback(speaking, { type: 'interrupt' })).toEqual({
      phase: 'idle',
      subtitle: null,
      playbackFailed: false,
    });
  });

  it('失败终态不会把 cue 留给下一轮', () => {
    expect(
      reduceLiveSpeechPlayback(
        { phase: 'speaking', subtitle: '旧字幕', playbackFailed: false },
        { type: 'fail' },
      ),
    ).toEqual({ phase: 'idle', subtitle: null, playbackFailed: true });
  });

  it('预取下一语义段时保持 speaking 和当前字幕连续', () => {
    expect(
      reduceLiveSpeechPlayback(
        { phase: 'speaking', subtitle: '上一段。', playbackFailed: false },
        { type: 'prepare' },
      ),
    ).toEqual({
      phase: 'speaking',
      subtitle: '上一段。',
      playbackFailed: false,
    });
  });
});

describe('streamSpeechIntoPlayer', () => {
  it('整轮只发送一次 TTS，并把字幕 cue 映射到真实 PCM 排期', async () => {
    const chunks = [new Uint8Array(24_000), new Uint8Array(24_000)];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                chunks.forEach((chunk) => controller.enqueue(chunk));
                controller.close();
              },
            }),
            { status: 200 },
          ),
        );
      },
    );
    let nextStart = 10;
    const player: LiveSpeechPcmPlayer = {
      enqueue: vi.fn(async (bytes: Uint8Array) => {
        const durationSeconds = bytes.byteLength / 2 / 24_000;
        const startAt = nextStart;
        nextStart += durationSeconds;
        return { startAt, endAt: nextStart, durationSeconds };
      }),
    };
    const cues: readonly LiveSubtitleCue[] = [
      {
        id: 'cue-1',
        text: '第一句。',
        startOffsetSeconds: 0,
        estimatedDurationSeconds: 0.75,
      },
      {
        id: 'cue-2',
        text: '第二句。',
        startOffsetSeconds: 0.75,
        estimatedDurationSeconds: 0.75,
      },
    ];
    const markers: Array<{ at: number; callback: () => void }> = [];
    const subtitles: string[] = [];

    const lastWindow = await streamSpeechIntoPlayer({
      text: '第一句。第二句。',
      signal: new AbortController().signal,
      player,
      cues,
      fetchImpl: fetchImpl as typeof fetch,
      onMarker: (at, callback) => markers.push({ at, callback }),
      onSubtitle: (text) => subtitles.push(text),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      text: '第一句。第二句。',
    });
    expect(markers.map((marker) => marker.at)).toEqual([10, 10.75]);
    markers.forEach((marker) => marker.callback());
    expect(subtitles).toEqual(['第一句。', '第二句。']);
    expect(lastWindow?.endAt).toBe(11);
  });

  it('按播放窗口而不是下载时刻更新输出能量', async () => {
    const levelMarkers: Array<{ at: number; callback: () => void }> = [];
    const levels: number[] = [];
    const player: LiveSpeechPcmPlayer = {
      enqueue: vi.fn(async () => ({
        startAt: 4,
        endAt: 4.5,
        durationSeconds: 0.5,
      })),
    };

    await streamSpeechIntoPlayer({
      text: '测试。',
      signal: new AbortController().signal,
      player,
      cues: [],
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response(
            new Uint8Array([0xff, 0x7f, 0xff, 0x7f, 0xff, 0x7f, 0xff, 0x7f]),
            { status: 200 },
          ),
        ),
      ) as typeof fetch,
      onMarker: () => undefined,
      onLevelMarker: (at, callback) => levelMarkers.push({ at, callback }),
      onSubtitle: () => undefined,
      onAudioLevel: (level) => levels.push(level),
    });

    expect(levels).toEqual([]);
    expect(levelMarkers.map((marker) => marker.at)).toEqual([4]);
    levelMarkers[0]!.callback();
    expect(levels[0]).toBeGreaterThan(0.9);
  });
});
