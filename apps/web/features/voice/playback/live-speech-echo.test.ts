import { describe, expect, it } from 'vitest';
import { isLikelyLivePlaybackEcho } from './live-speech-echo';

describe('isLikelyLivePlaybackEcho', () => {
  it('正在播音时识别当前字幕及少量 ASR 误差', () => {
    expect(
      isLikelyLivePlaybackEcho({
        transcript: '我们先明确目标再选择合适的实现路径',
        assistantText:
          '我们先明确目标，再选择最合适的实现路径。接下来逐步验证。',
        assistantSubtitle: '我们先明确目标，再选择最合适的实现路径。',
        playbackRecentlyActive: true,
      }),
    ).toBe(true);
  });

  it('不同内容的用户插话不会被回声门闩吞掉', () => {
    expect(
      isLikelyLivePlaybackEcho({
        transcript: '停一下，我想换一个问题',
        assistantText: '我们先明确目标，再选择最合适的实现路径。',
        assistantSubtitle: '我们先明确目标。',
        playbackRecentlyActive: true,
      }),
    ).toBe(false);
  });

  it('不在播放窗口时允许用户复述 Assistant', () => {
    expect(
      isLikelyLivePlaybackEcho({
        transcript: '我们先明确目标',
        assistantText: '我们先明确目标。',
        assistantSubtitle: null,
        playbackRecentlyActive: false,
      }),
    ).toBe(false);
  });
});
