import { describe, expect, it } from 'vitest';
import { takeSemanticSpeechSegments } from './semantic-segmentation';

function defaults(
  overrides: Partial<Parameters<typeof takeSemanticSpeechSegments>[0]> = {},
) {
  return {
    text: '',
    consumedCharacters: 0,
    segmentCount: 0,
    complete: false,
    nowMs: 1000,
    lastCommittedAtMs: 0,
    ...overrides,
  };
}

describe('takeSemanticSpeechSegments', () => {
  it('中文完整句立即释放', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '这是第一句。第二句还没说完',
        complete: false,
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.segments[0]!.text).toBe('这是第一句。');
    expect(result.segments[0]!.startCursor).toBe(0);
    expect(result.segments[0]!.endCursor).toBe(6);
  });

  it('英文完整句与缩写不误切', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: 'Mr. Smith went to Washington. Then he came back.',
        complete: false,
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.segments[0]!.text).toBe('Mr. Smith went to Washington.');
    expect(result.segments[0]!.endCursor).toBe(29);
  });

  it('小数不误切', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '圆周率约等于3.14159。这是一个重要的数学常数。',
        complete: false,
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    // The decimal 3.14159 must be intact within a single segment — not split at the dot.
    expect(result.segments[0]!.text).toContain('3.14159');
  });

  it('首段比后续段更快释放', () => {
    const longText = '这是第一段。'.repeat(5);
    const firstResult = takeSemanticSpeechSegments(
      defaults({ text: longText }),
    );
    const firstSegmentLen = [...firstResult.segments[0]!.text].length;

    const secondResult = takeSemanticSpeechSegments(
      defaults({
        text: longText + '这是第二段。',
        consumedCharacters: firstResult.consumedCharacters,
        segmentCount: 1,
      }),
    );
    if (secondResult.segments.length > 0) {
      const secondSegmentLen = [...secondResult.segments[0]!.text].length;
      expect(secondSegmentLen).toBeGreaterThanOrEqual(firstSegmentLen);
    }
  });

  it('无标点长句在软边界释放', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '我们先观察这张图片里的坐标轴，然后再比较两条曲线之间的变化关系',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.segments[0]!.text).toContain('坐标轴，');
  });

  it('超过等待预算后安全释放稳定短语', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '这是一个很长的句子中间没有标点符号但是有一些内容可以释放',
        nowMs: 2000,
        lastCommittedAtMs: 0,
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.consumedCharacters).toBeGreaterThan(0);
  });

  it('未达到安全边界继续等待', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '短',
        complete: false,
        nowMs: 100,
        lastCommittedAtMs: 0,
      }),
    );
    expect(result.segments).toHaveLength(0);
    expect(result.consumedCharacters).toBe(0);
  });

  it('completed冲刷最后自然语言尾句', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '最后补充一点',
        complete: true,
      }),
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.text).toBe('最后补充一点');
    expect(result.segments[0]!.startCursor).toBe(0);
    expect(result.segments[0]!.endCursor).toBe(6);
  });

  it('Markdown链接只朗读label的raw文本保留offset', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '请参考[官方文档](https://example.com)了解更多。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.segments[0]!.text).toContain('[官方文档]');
    expect(result.segments[0]!.startCursor).toBe(0);
  });

  it('代码块不朗读', () => {
    const fence = '```';
    const input =
      '看这个例子：' + fence + 'console.log("hello")' + fence + '然后继续';
    const result = takeSemanticSpeechSegments(defaults({ text: input }));
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('console.log');
  });

  it('inline code不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '使用`npm install`命令安装依赖。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('npm install');
  });

  it('公式不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '公式如下：$E=mc^2$然后继续讨论。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('E=mc^2');
  });

  it('图片不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '看这张图：![风景](photo.jpg)很美。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('风景');
    expect(allText).not.toContain('photo.jpg');
  });

  it('URL不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '访问https://example.com/path?query=1了解更多。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('https://example.com');
  });

  it('中英文数字混排不在单词或数字内部断开', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '中文abc123中文测试。',
      }),
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.text).toBe('中文abc123中文测试。');
  });

  it('原文offset单调且与L02游标兼容', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '第一句。第二句。第三句。',
      }),
    );
    let prevEnd = 0;
    for (const seg of result.segments) {
      expect(seg.startCursor).toBeGreaterThanOrEqual(prevEnd);
      expect(seg.endCursor).toBeGreaterThan(seg.startCursor);
      prevEnd = seg.endCursor;
    }
    expect(result.consumedCharacters).toBe(prevEnd);
  });

  it('空白内容不产生TTS请求', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '   \n\t  ',
        complete: true,
      }),
    );
    expect(result.segments).toHaveLength(0);
  });

  it('相同输入具有确定输出', () => {
    const input = defaults({
      text: '这是测试句子。第二句。',
      nowMs: 5000,
      lastCommittedAtMs: 4000,
    });
    const result1 = takeSemanticSpeechSegments(input);
    const result2 = takeSemanticSpeechSegments(input);
    expect(result1).toEqual(result2);
  });

  it('consumedCharacters只返回尚未播报的新内容', () => {
    const first = '第一部分已经播报。';
    const result = takeSemanticSpeechSegments(
      defaults({
        text: first + '第二部分现在完成。',
        consumedCharacters: first.length,
        segmentCount: 1,
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.segments[0]!.startCursor).toBe(first.length);
    expect(result.segments[0]!.text).toContain('第二部分');
  });

  it('display公式不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '公式展示：$$E=mc^2$$然后继续。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('E=mc^2');
  });

  it('方括号公式不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '公式如下：\\[\\int_0^1 f(x)dx\\]然后继续。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('\\int');
  });

  it('JSON对象不朗读', () => {
    const result = takeSemanticSpeechSegments(
      defaults({
        text: '数据格式：{"key":"value","count":42}这是说明。',
      }),
    );
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    const allText = result.segments.map((s) => s.text).join('');
    expect(allText).not.toContain('"key"');
  });
});
