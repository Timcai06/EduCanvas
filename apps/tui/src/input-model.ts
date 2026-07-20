import { codePointWidth, padToWidth, stringWidth, truncateToWidth } from './text';
import type { TuiTheme } from './theme';

/**
 * 输入框的纯视图逻辑：光标窗口、斜杠命令匹配与补全、框体渲染。
 * 与终端 raw mode 的交互放在 input-box.ts；这里全部是可单测的纯函数，
 * CJK 光标定位必须经过显示宽度计算，禁止用字符下标近似列号。
 */

export interface SlashCommand {
  name: string;
  description: string;
}

/** 交互式 REPL 支持的全部斜杠命令；顺序即补全提示顺序。 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: '/notebooks', description: '列出笔记本' },
  { name: '/use', description: '切换笔记本' },
  { name: '/resume', description: '回看历史回答' },
  { name: '/approvals', description: '待审批事项' },
  { name: '/approve', description: '同意审批' },
  { name: '/deny', description: '拒绝审批' },
  { name: '/web', description: '打开网页端' },
  { name: '/help', description: '命令说明' },
  { name: '/quit', description: '退出' },
];

/** 输入首个词是斜杠前缀时给出候选；已输入空格说明命令已选定，不再提示。 */
export function matchSlashCommands(
  value: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): readonly SlashCommand[] {
  if (!value.startsWith('/') || value.includes(' ')) return [];
  return commands.filter((command) => command.name.startsWith(value));
}

/** Tab 补全：唯一候选补全整个命令并带尾随空格；多候选补全公共前缀。 */
export function completeSlashCommand(
  value: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): string | null {
  const matches = matchSlashCommands(value, commands);
  if (matches.length === 0) return null;
  if (matches.length === 1) return `${matches[0]!.name} `;
  let prefix = matches[0]!.name;
  for (const match of matches) {
    while (!match.name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix.length > value.length ? prefix : null;
}

export interface InputWindow {
  /** 应显示的文本切片（可能是完整输入的窗口）。 */
  text: string;
  /** 光标相对切片起点的显示列偏移。 */
  cursorCol: number;
}

/**
 * 输入超过框宽时的水平滚动窗口：保证光标始终可见，
 * 优先展示光标左侧内容。cursor 为码点下标。
 */
export function computeInputWindow(
  value: string,
  cursor: number,
  innerWidth: number,
): InputWindow {
  const chars = [...value];
  const clampedCursor = Math.min(Math.max(cursor, 0), chars.length);
  /* 从光标向左回退，装满 innerWidth-1（预留光标本身一列） */
  let start = clampedCursor;
  let used = 0;
  while (start > 0) {
    const charWidth = codePointWidth(chars[start - 1]!.codePointAt(0)!);
    if (used + charWidth > innerWidth - 1) break;
    used += charWidth;
    start -= 1;
  }
  let text = '';
  let width = 0;
  for (let index = start; index < chars.length; index += 1) {
    const charWidth = codePointWidth(chars[index]!.codePointAt(0)!);
    if (width + charWidth > innerWidth) break;
    text += chars[index]!;
    width += charWidth;
  }
  return {
    text,
    cursorCol: stringWidth(chars.slice(start, clampedCursor).join('')),
  };
}

/** 光标（码点下标）落在第几条逻辑行、行内第几个码点。 */
export interface LineCol {
  lineIndex: number;
  charOffset: number;
}

export function cursorToLineCol(value: string, cursor: number): LineCol {
  const chars = [...value];
  const clamped = Math.min(Math.max(cursor, 0), chars.length);
  let lineIndex = 0;
  let charOffset = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (chars[index] === '\n') {
      lineIndex += 1;
      charOffset = 0;
    } else {
      charOffset += 1;
    }
  }
  return { lineIndex, charOffset };
}

export function lineColToCursor(
  value: string,
  lineIndex: number,
  charOffset: number,
): number {
  const lines = value.split('\n');
  const clampedLine = Math.min(Math.max(lineIndex, 0), lines.length - 1);
  let cursor = 0;
  for (let index = 0; index < clampedLine; index += 1) {
    cursor += [...lines[index]!].length + 1; /* +1 为换行符本身 */
  }
  const lineLength = [...lines[clampedLine]!].length;
  return cursor + Math.min(Math.max(charOffset, 0), lineLength);
}

export interface InputFrameState {
  value: string;
  cursor: number;
  placeholder: string;
  /** 框体下方的常驻状态行（当前笔记本、连接、待审批）。 */
  statusLine: string;
  /** 斜杠候选；非空时替代状态行显示。 */
  suggestions: readonly SlashCommand[];
}

export interface InputFrame {
  lines: readonly string[];
  /** 终端光标应落在第几行（0 起）与第几列（0 起，含边框）。 */
  cursorRow: number;
  cursorCol: number;
}

/** 多行输入框体最多显示的正文行数；超出按光标所在行开窗滚动。 */
const MAX_BODY_ROWS = 6;

interface BodyLayout {
  rows: readonly string[];
  cursorBodyRow: number;
  cursorCol: number;
}

/**
 * 计算多行正文的可见窗口与光标位置。逻辑行按 \n 切分；光标所在行用水平
 * 滚动窗口保证可见，其余行按显示宽度截断；逻辑行数超过上限时以光标行为中心
 * 纵向开窗。返回的 cursorCol 已含 4 列前缀（边框 + ✎/缩进）。
 */
function layoutBody(
  value: string,
  cursor: number,
  innerWidth: number,
): BodyLayout {
  const logicalLines = value.split('\n');
  const { lineIndex, charOffset } = cursorToLineCol(value, cursor);

  let windowStart = 0;
  if (logicalLines.length > MAX_BODY_ROWS) {
    windowStart = Math.min(
      Math.max(lineIndex - Math.floor(MAX_BODY_ROWS / 2), 0),
      logicalLines.length - MAX_BODY_ROWS,
    );
  }
  const visible = logicalLines.slice(windowStart, windowStart + MAX_BODY_ROWS);

  let cursorCol = 4;
  const rows = visible.map((lineText, offset) => {
    const absoluteIndex = windowStart + offset;
    if (absoluteIndex === lineIndex) {
      const window = computeInputWindow(lineText, charOffset, innerWidth);
      cursorCol = 4 + window.cursorCol;
      return window.text;
    }
    return truncateToWidth(lineText, innerWidth);
  });
  return { rows, cursorBodyRow: lineIndex - windowStart, cursorCol };
}

/**
 * 渲染 Claude Code 式输入框：圆角细线框 + ✎ 笔标 + 底部状态/补全行。
 * 支持多行输入（Shift+Enter/Alt+Enter/反斜杠续行）。返回行数组与光标坐标，
 * 由 input-box.ts 负责贴到终端上。
 */
export function renderInputFrame(
  theme: TuiTheme,
  width: number,
  state: InputFrameState,
): InputFrame {
  const frameWidth = Math.max(30, Math.min(width - 2, 76));
  const innerWidth = frameWidth - 4 - 2; /* 边框+内边距 4，✎+空格 2 */
  const border = (value: string) => theme.dim(value);

  const empty = state.value.length === 0;
  const layout = empty
    ? {
        rows: [theme.dim(truncateToWidth(state.placeholder, innerWidth))],
        cursorBodyRow: 0,
        cursorCol: 4,
      }
    : layoutBody(state.value, state.cursor, innerWidth);

  const bodyLines = layout.rows.map((rowText, index) => {
    /* 首行挂 ✎ 笔标，续行留 3 空格缩进使正文对齐在同一列 */
    const prefix = index === 0 ? `${theme.dai('✎')} ` : '  ';
    const padded =
      empty && index === 0
        ? rowText + ' '.repeat(Math.max(0, innerWidth - stringWidth(state.placeholder)))
        : padToWidth(rowText, innerWidth);
    return `${border('│')} ${prefix}${padded} ${border('│')}`;
  });

  const footer =
    state.suggestions.length > 0
      ? `  ${state.suggestions
          .slice(0, 4)
          .map(
            (command) =>
              `${theme.dai(command.name)} ${theme.dim(command.description)}`,
          )
          .join(theme.dim(' · '))}${theme.dim(' — Tab 补全 · Shift+Enter 换行')}`
      : `  ${theme.dim(truncateToWidth(state.statusLine, frameWidth - 2))}`;

  return {
    lines: [
      border(`╭${'─'.repeat(frameWidth - 2)}╮`),
      ...bodyLines,
      border(`╰${'─'.repeat(frameWidth - 2)}╯`),
      footer,
    ],
    cursorRow: 1 + layout.cursorBodyRow,
    cursorCol: layout.cursorCol,
  };
}
