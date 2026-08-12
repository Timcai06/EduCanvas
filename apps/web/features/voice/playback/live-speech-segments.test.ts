import { describe, expect, it } from 'vitest';
import { takeLiveSpeechSegments } from './live-speech-segments';

describe('takeLiveSpeechSegments', () => {
  it('首个完整短句立即释放，未闭合尾句继续等待', () => {
    const result = takeLiveSpeechSegments({
      text: '这是第一句，先建立背景。第二句还没有结束',
      consumedCharacters: 0,
      segmentCount: 0,
      complete: false,
    });
    expect(result.segments).toEqual([
      {
        text: '这是第一句，先建立背景。',
        startCursor: 0,
        endCursor: '这是第一句，先建立背景。'.length,
      },
    ]);
    expect(result.consumedCharacters).toBe('这是第一句，先建立背景。'.length);
  });

  it('长时间没有句号时按有意义的软边界释放，避免首音一直等待', () => {
    const text =
      '我们先观察这张图片里的坐标轴，然后再比较两条曲线之间的变化关系';
    const result = takeLiveSpeechSegments({
      text,
      consumedCharacters: 0,
      segmentCount: 0,
      complete: false,
    });
    expect(result.segments[0]).toMatchObject({
      text: '我们先观察这张图片里的坐标轴，',
      startCursor: 0,
    });
    expect(result.consumedCharacters).toBe(result.segments[0]!.endCursor);
  });

  it('Turn 完成时冲刷最后一个短尾句', () => {
    expect(
      takeLiveSpeechSegments({
        text: '最后补充一点',
        consumedCharacters: 0,
        segmentCount: 0,
        complete: true,
      }),
    ).toEqual({
      segments: [{ text: '最后补充一点', startCursor: 0, endCursor: 6 }],
      consumedCharacters: 6,
    });
  });

  it('增量游标只返回尚未播报的新内容', () => {
    const first = '第一部分已经播报。';
    const result = takeLiveSpeechSegments({
      text: `${first}第二部分现在完成。`,
      consumedCharacters: first.length,
      segmentCount: 1,
      complete: false,
    });
    expect(result.segments).toEqual([
      {
        text: '第二部分现在完成。',
        startCursor: first.length,
        endCursor: `${first}第二部分现在完成。`.length,
      },
    ]);
  });
});
