/**
 * 终端文本度量与排版的纯函数层。中文是一等公民：所有框线、卡片和对齐
 * 都必须经过这里的显示宽度计算，禁止直接用 string.length 排版——
 * CJK 字符占两列，ANSI 转义占零列，混排时 length 必然画歪。
 */

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** 东亚宽字符（占两列）的码点区间；覆盖 CJK 统一表意、标点、假名、谚文与全角形式。 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

/** 零宽码点：组合附标、变体选择符、零宽连接等。 */
const ZERO_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];

function inRanges(
  codePoint: number,
  ranges: readonly (readonly [number, number])[],
): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** 单个码点的显示列宽（0/1/2）。 */
export function codePointWidth(codePoint: number): 0 | 1 | 2 {
  if (inRanges(codePoint, ZERO_RANGES)) return 0;
  if (inRanges(codePoint, WIDE_RANGES)) return 2;
  return 1;
}

/** 去掉 SGR 转义序列，返回可见字符串。 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/** 字符串的显示列宽；ANSI 转义不计入。 */
export function stringWidth(value: string): number {
  let width = 0;
  for (const char of stripAnsi(value)) {
    width += codePointWidth(char.codePointAt(0)!);
  }
  return width;
}

/**
 * 按显示宽度换行。CJK 字符前后都是合法断点；拉丁词优先在空格断开，
 * 超宽的单词才被硬切。不处理 ANSI（调用方先排版、后上色）。
 */
export function wrapToWidth(text: string, width: number): string[] {
  if (width < 2) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    let lineWidth = 0;
    let word = '';
    let wordWidth = 0;

    const flushWord = () => {
      if (!word) return;
      if (lineWidth + wordWidth > width && lineWidth > 0) {
        lines.push(line.trimEnd());
        line = '';
        lineWidth = 0;
      }
      /* 单词本身超过整行宽度时硬切 */
      for (const char of word) {
        const charWidth = codePointWidth(char.codePointAt(0)!);
        if (lineWidth + charWidth > width && lineWidth > 0) {
          lines.push(line.trimEnd());
          line = '';
          lineWidth = 0;
        }
        line += char;
        lineWidth += charWidth;
      }
      word = '';
      wordWidth = 0;
    };

    for (const char of paragraph) {
      const codePoint = char.codePointAt(0)!;
      const charWidth = codePointWidth(codePoint);
      if (char === ' ') {
        flushWord();
        if (lineWidth + 1 > width) {
          lines.push(line.trimEnd());
          line = '';
          lineWidth = 0;
        } else if (lineWidth > 0) {
          line += ' ';
          lineWidth += 1;
        }
      } else if (charWidth === 2) {
        flushWord();
        if (lineWidth + charWidth > width && lineWidth > 0) {
          lines.push(line.trimEnd());
          line = '';
          lineWidth = 0;
        }
        line += char;
        lineWidth += charWidth;
      } else {
        word += char;
        wordWidth += charWidth;
      }
    }
    flushWord();
    lines.push(line.trimEnd());
  }
  return lines;
}

/** 截断到指定显示宽度，超出时以省略号结尾。 */
export function truncateToWidth(value: string, width: number): string {
  if (stringWidth(value) <= width) return value;
  const target = Math.max(0, width - 1);
  let result = '';
  let currentWidth = 0;
  for (const char of value) {
    const charWidth = codePointWidth(char.codePointAt(0)!);
    if (currentWidth + charWidth > target) break;
    result += char;
    currentWidth += charWidth;
  }
  return `${result}…`;
}

/** 右侧补空格到指定显示宽度（用于框线卡片内的行对齐）。 */
export function padToWidth(value: string, width: number): string {
  const gap = width - stringWidth(value);
  return gap > 0 ? value + ' '.repeat(gap) : value;
}
