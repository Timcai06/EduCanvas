import { describe, expect, it } from 'vitest';
import {
  createLiveSubtitleCues,
  prepareLiveSpeechText,
} from './live-speech-text';
import { createSubtitleDurationClock } from './subtitle-clock/recovery';

describe('prepareLiveSpeechText', () => {
  it('一次性保留自然段落并移除 Markdown、链接、代码与公式语法', () => {
    const text = prepareLiveSpeechText(`
## 欧拉公式

这是 **核心结论**。[参考资料](https://example.invalid) [1]

\\[e^{i\\pi}+1=0\\]

\`\`\`ts
const answer = 42;
\`\`\`
`);
    expect(text).toBe(
      '欧拉公式。这是 核心结论。参考资料。具体公式已经显示在聊天记录里。代码示例已经放在聊天记录里。',
    );
    expect(text).not.toContain('https://');
    expect(text).not.toContain('const answer');
  });

  it('超长回答在句末截断并明确提示回看聊天记录', () => {
    expect(prepareLiveSpeechText('第一句。第二句。第三句。', 8)).toBe(
      '第一句。第二句。更多细节已经放在聊天记录里。',
    );
  });
});

describe('createLiveSubtitleCues', () => {
  it('按句子和长分句生成单调递增的播放时间标记', () => {
    const cues = createLiveSubtitleCues(
      '先看第一个结论。接下来这一句比较长，需要在逗号附近自然换成新的字幕短语，而不是整段一起跳出来。最后总结。',
    );
    expect(cues.length).toBeGreaterThanOrEqual(4);
    expect(cues[0]?.startOffsetSeconds).toBe(0);
    expect(cues.every((cue) => [...cue.text].length <= 34)).toBe(true);
    expect(
      cues.slice(1).every((cue, index) => {
        const previous = cues[index]!;
        return (
          cue.startOffsetSeconds ===
          previous.startOffsetSeconds + previous.estimatedDurationSeconds
        );
      }),
    ).toBe(true);
  });

  it('可按真实累计 PCM 时长做确定性缩放', () => {
    const clock = createSubtitleDurationClock();
    const first = createLiveSubtitleCues('第一句。第二句。第三句。', {
      durationClock: clock,
    });
    const rawTotal = first.reduce(
      (total, cue) => total + cue.estimatedDurationSeconds,
      0,
    );
    clock.observe(2.4, rawTotal);

    const second = createLiveSubtitleCues('第一句。第二句。第三句。', {
      durationClock: clock,
    });
    const secondTotal = second.reduce(
      (total, cue) => total + cue.estimatedDurationSeconds,
      0,
    );
    expect(secondTotal).toBeGreaterThan(0.8);
    expect(secondTotal).toBeCloseTo(rawTotal * clock.getScaleFactor());
    expect(
      second.every((cue, index) => {
        if (index === 0) return true;
        return (
          cue.startOffsetSeconds ===
          second[index - 1]!.startOffsetSeconds +
            second[index - 1]!.estimatedDurationSeconds
        );
      }),
    ).toBe(true);
  });
});
