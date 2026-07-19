import { describe, expect, it } from 'vitest';
import {
  padToWidth,
  stringWidth,
  stripAnsi,
  truncateToWidth,
  wrapToWidth,
} from './text';
import { createTheme } from './theme';

describe('stringWidth', () => {
  it('counts CJK as double width and ANSI as zero', () => {
    expect(stringWidth('abc')).toBe(3);
    expect(stringWidth('分数')).toBe(4);
    expect(stringWidth('a分b数')).toBe(6);
    const theme = createTheme({ isTTY: true, noColor: false, term: 'xterm' });
    expect(stringWidth(theme.zhusha('朱砂'))).toBe(4);
  });

  it('treats fullwidth punctuation as double width', () => {
    expect(stringWidth('，。！')).toBe(6);
  });
});

describe('stripAnsi', () => {
  it('removes SGR sequences only', () => {
    const theme = createTheme({ isTTY: true, noColor: false, term: 'xterm' });
    expect(stripAnsi(theme.bold('x[1m'))).toBe('x[1m');
  });
});

describe('wrapToWidth', () => {
  it('breaks CJK text at any character boundary', () => {
    const lines = wrapToWidth('通分就是把分母不同的分数改写成分母相同', 10);
    expect(lines.every((line) => stringWidth(line) <= 10)).toBe(true);
    expect(lines.join('')).toBe('通分就是把分母不同的分数改写成分母相同');
  });

  it('prefers spaces for latin words and hard-breaks overlong words', () => {
    expect(wrapToWidth('hello world', 6)).toEqual(['hello', 'world']);
    expect(wrapToWidth('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('handles mixed CJK and latin without exceeding width', () => {
    const lines = wrapToWidth('用 Python 写一个 hello 分数计算器', 12);
    expect(lines.every((line) => stringWidth(line) <= 12)).toBe(true);
  });

  it('keeps paragraphs separated', () => {
    expect(wrapToWidth('甲\n乙', 10)).toEqual(['甲', '乙']);
  });
});

describe('truncateToWidth', () => {
  it('returns unchanged when it fits', () => {
    expect(truncateToWidth('分数', 4)).toBe('分数');
  });

  it('truncates with ellipsis at display width', () => {
    const truncated = truncateToWidth('分数运算专项练习', 8);
    expect(stringWidth(truncated)).toBeLessThanOrEqual(8);
    expect(truncated.endsWith('…')).toBe(true);
  });
});

describe('padToWidth', () => {
  it('pads by display width so CJK columns align', () => {
    expect(stringWidth(padToWidth('中文', 8))).toBe(8);
    expect(stringWidth(padToWidth('abc', 8))).toBe(8);
  });
});
