import { describe, expect, it } from 'vitest';
import { MarkdownStream } from './markdown-stream';
import { stripAnsi } from './text';
import { createTheme } from './theme';

const color = createTheme({
  isTTY: true,
  noColor: false,
  term: 'xterm',
  colorterm: undefined,
  forceDepth: undefined,
});
const plain = createTheme({
  isTTY: false,
  noColor: true,
  term: undefined,
  colorterm: undefined,
  forceDepth: undefined,
});

function renderAll(chunks: readonly string[], theme = color): string {
  const stream = new MarkdownStream(theme);
  return chunks.map((chunk) => stream.push(chunk)).join('') + stream.flush();
}

describe('MarkdownStream', () => {
  it('passes everything through untouched without colors', () => {
    const raw = '# 标题\n**加粗** 和 `代码`\n';
    expect(renderAll([raw], plain)).toBe(raw);
  });

  it('styles headings and strips nothing', () => {
    const out = renderAll(['## 通分的步骤\n正文']);
    expect(stripAnsi(out)).toBe('## 通分的步骤\n正文');
    expect(out).toContain('[1m');
  });

  it('replaces list bullets and keeps numbered lists', () => {
    const out = renderAll(['- 第一步\n2. 第二步\n']);
    expect(stripAnsi(out)).toBe('• 第一步\n2. 第二步\n');
  });

  it('converts inline markers even when split across chunks', () => {
    const out = renderAll(['**加', '粗** 与 `co', 'de` 结束']);
    expect(stripAnsi(out)).toBe('加粗 与 code 结束');
    expect(out).toContain('[1m');
    expect(out).toContain('[36m');
  });

  it('keeps a lone asterisk literal', () => {
    expect(stripAnsi(renderAll(['3 * 4 = 12\n']))).toBe('3 * 4 = 12\n');
  });

  it('dims fenced code without transforming its content', () => {
    const out = renderAll(['```python\nprint("**hi**")\n```\n后续']);
    const visible = stripAnsi(out);
    expect(visible).toBe('```python\nprint("**hi**")\n```\n后续');
  });

  it('resets styles at every newline so unclosed markers cannot leak', () => {
    const out = renderAll(['**未闭合\n下一行\n']);
    const lines = out.split('\n');
    expect(lines[1]!.startsWith('下一行')).toBe(true);
  });

  it('styles blockquotes as dimmed margin lines', () => {
    expect(stripAnsi(renderAll(['> 引文内容\n']))).toBe('┃ 引文内容\n');
  });
});
