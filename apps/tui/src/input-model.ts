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

/**
 * 渲染 Claude Code 式输入框：圆角细线框 + ✎ 笔标 + 底部状态/补全行。
 * 返回行数组与光标坐标，由 input-box.ts 负责贴到终端上。
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
  const window = computeInputWindow(state.value, state.cursor, innerWidth);
  const body = empty
    ? theme.dim(truncateToWidth(state.placeholder, innerWidth))
    : window.text;
  const bodyPadded = padToWidth(body, innerWidth);

  const footer =
    state.suggestions.length > 0
      ? `  ${state.suggestions
          .slice(0, 4)
          .map(
            (command) =>
              `${theme.dai(command.name)} ${theme.dim(command.description)}`,
          )
          .join(theme.dim(' · '))}${theme.dim(' — Tab 补全')}`
      : `  ${theme.dim(truncateToWidth(state.statusLine, frameWidth - 2))}`;

  return {
    lines: [
      border(`╭${'─'.repeat(frameWidth - 2)}╮`),
      `${border('│')} ${theme.dai('✎')} ${bodyPadded} ${border('│')}`,
      border(`╰${'─'.repeat(frameWidth - 2)}╯`),
      footer,
    ],
    cursorRow: 1,
    /* │(1) + 空格(1) + ✎(1) + 空格(1) = 4 列后进入正文 */
    cursorCol: 4 + (empty ? 0 : window.cursorCol),
  };
}
