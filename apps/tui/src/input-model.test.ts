import { describe, expect, it } from 'vitest';
import {
  completeSlashCommand,
  computeInputWindow,
  matchSlashCommands,
  renderInputFrame,
  SLASH_COMMANDS,
} from './input-model';
import { stringWidth, stripAnsi } from './text';
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

describe('matchSlashCommands', () => {
  it('suggests only for slash-prefixed first tokens', () => {
    expect(matchSlashCommands('你好')).toHaveLength(0);
    expect(matchSlashCommands('/app').map((c) => c.name)).toEqual([
      '/approvals',
      '/approve',
    ]);
    expect(matchSlashCommands('/use 1')).toHaveLength(0);
  });

  it('lists everything for a bare slash', () => {
    expect(matchSlashCommands('/')).toHaveLength(SLASH_COMMANDS.length);
  });
});

describe('completeSlashCommand', () => {
  it('completes a unique match with a trailing space', () => {
    expect(completeSlashCommand('/not')).toBe('/notebooks ');
  });

  it('extends to the common prefix when ambiguous', () => {
    expect(completeSlashCommand('/a')).toBe('/approv');
    expect(completeSlashCommand('/approv')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(completeSlashCommand('/zzz')).toBeNull();
  });
});

describe('computeInputWindow', () => {
  it('keeps short values intact with CJK-aware cursor column', () => {
    const window = computeInputWindow('分数abc', 2, 40);
    expect(window.text).toBe('分数abc');
    expect(window.cursorCol).toBe(4);
  });

  it('scrolls long input so the cursor stays visible', () => {
    const value = '一二三四五六七八九十'.repeat(3);
    const window = computeInputWindow(value, [...value].length, 20);
    expect(stringWidth(window.text)).toBeLessThanOrEqual(20);
    expect(window.cursorCol).toBeLessThanOrEqual(20);
  });
});

describe('renderInputFrame', () => {
  const baseState = {
    value: '',
    cursor: 0,
    placeholder: '输入问题，/ 呼出命令',
    statusLine: '分数运算 · ● 已连接',
    suggestions: [],
  };

  it('keeps the frame borders aligned with CJK content', () => {
    const frame = renderInputFrame(plain, 80, {
      ...baseState,
      value: '什么是分数的通分？',
      cursor: 5,
    });
    const [top, body, bottom] = frame.lines;
    expect(stringWidth(top!)).toBe(stringWidth(body!));
    expect(stringWidth(top!)).toBe(stringWidth(bottom!));
  });

  it('shows the placeholder only when empty', () => {
    const empty = renderInputFrame(plain, 80, baseState);
    expect(stripAnsi(empty.lines[1]!)).toContain('输入问题');
    const typed = renderInputFrame(plain, 80, {
      ...baseState,
      value: 'abc',
      cursor: 3,
    });
    expect(stripAnsi(typed.lines[1]!)).not.toContain('输入问题');
  });

  it('replaces the status line with suggestions while typing a slash command', () => {
    const frame = renderInputFrame(color, 80, {
      ...baseState,
      value: '/app',
      cursor: 4,
      suggestions: matchSlashCommands('/app'),
    });
    const footer = stripAnsi(frame.lines[3]!);
    expect(footer).toContain('/approvals');
    expect(footer).toContain('Tab 补全');
    expect(footer).not.toContain('已连接');
  });

  it('positions the cursor after the pen glyph respecting CJK widths', () => {
    const frame = renderInputFrame(plain, 80, {
      ...baseState,
      value: '分数',
      cursor: 1,
    });
    /* │ + 空格 + ✎ + 空格 = 4 列，「分」占 2 列 → 光标列 6 */
    expect(frame.cursorCol).toBe(6);
    expect(frame.cursorRow).toBe(1);
  });
});
