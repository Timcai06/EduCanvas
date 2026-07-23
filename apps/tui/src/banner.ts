import { padToWidth, stringWidth, truncateToWidth } from './text';
import type { TuiTheme } from './theme';

/**
 * 扉页：进入 TUI 或切换笔记本时的「翻开笔记本」时刻。
 * 宽终端（≥62 列）是完整仪式：实心朱砂印章 + 墨色渐变块体字标；
 * 中等宽度退到框线印章 + 粗体字；窄终端（<46 列）只剩单行标题——
 * 装饰永远先于信息退场，无色环境自动回落为纯文本。
 */

export interface BannerInfo {
  /** 笔记本标题；null 显示为未命名。 */
  title: string | null;
  /** 标题下的补充行（会话状态、可用命令提示），最多两行。 */
  detailLines?: readonly string[];
}

const FULL_WIDTH = 62;
const COMPACT_WIDTH = 46;

/**
 * 自绘 3 行块体字（宽 4 列 + 1 列间距）。只覆盖字标用到的字母，
 * 不引入 figlet 依赖，也避免外部字体在不同终端的渲染歧义。
 */
const BLOCK_LETTERS: Record<string, readonly [string, string, string]> = {
  E: ['█▀▀▀', '█▀▀ ', '▀▀▀▀'],
  D: ['█▀▀▄', '█  █', '▀▀▀▀'],
  U: ['█  █', '█  █', '▀▀▀▀'],
  C: ['█▀▀▀', '█   ', '▀▀▀▀'],
  A: ['█▀▀█', '█▀▀█', '▀  ▀'],
  N: ['█▀▀█', '█  █', '▀  ▀'],
  V: ['█  █', '█  █', ' ▀▀ '],
  S: ['█▀▀▀', '▀▀▀█', '▀▀▀▀'],
};

const WORDMARK = 'EDUCANVAS';

/** 逐字上渐变色的块体字标，返回 3 行。 */
function wordmarkLines(theme: TuiTheme): readonly string[] {
  const letters = [...WORDMARK];
  return [0, 1, 2].map((row) =>
    letters
      .map((letter, index) =>
        theme.daiGradient(
          BLOCK_LETTERS[letter]![row]!,
          letters.length > 1 ? index / (letters.length - 1) : 0,
        ),
      )
      .join(' '),
  );
}

/** 实心朱砂印章（5×3 色块 + 白色对勾）；无色环境回落为框线章。 */
function sealLines(theme: TuiTheme): readonly string[] {
  if (theme.enabled) {
    return [
      theme.sealBlock('     '),
      theme.sealBlock('  ✓  '),
      theme.sealBlock('     '),
    ];
  }
  return ['▛▀▀▀▜', '▌ ✓ ▐', '▙▄▄▄▟'];
}

/** `── ✎ ──…` 分隔线：落笔符号偏左，其余延展到给定宽度。 */
export function renderRule(theme: TuiTheme, width: number): string {
  const total = Math.max(12, Math.min(width, 72));
  const left = '── ✎ ';
  return theme.dim(left + '─'.repeat(total - stringWidth(left)));
}

export function renderBanner(
  theme: TuiTheme,
  width: number,
  info: BannerInfo,
): string {
  const title = info.title ?? '未命名笔记本';
  if (width < COMPACT_WIDTH) {
    return [
      renderRule(theme, width - 1),
      `${theme.seal('✓')} ${theme.bold('EduCanvas')} · ${truncateToWidth(title, Math.max(8, width - 16))}`,
      renderRule(theme, width - 1),
      '',
    ].join('\n');
  }

  const seal = sealLines(theme);
  const textWidth = width - 10;
  const detailLines = (info.detailLines ?? []).map((line) =>
    theme.dim(truncateToWidth(line, textWidth)),
  );

  if (width >= FULL_WIDTH) {
    const mark = wordmarkLines(theme);
    return [
      renderRule(theme, width - 1),
      ...[0, 1, 2].map((row) => ` ${seal[row]!}   ${mark[row]!}`),
      '',
      ` ${theme.zhusha('▍')} ${theme.bold(truncateToWidth(title, textWidth))}`,
      ...detailLines.map((line) => `   ${line}`),
      renderRule(theme, width - 1),
      '',
    ].join('\n');
  }

  const textLines = [
    `${theme.bold('EduCanvas')} ${theme.dim('·')} ${truncateToWidth(title, Math.max(8, textWidth - 12))}`,
    ...detailLines,
  ];
  const rows = Math.max(seal.length, textLines.length);
  const body = Array.from({ length: rows }, (_, index) => {
    const left = seal[index] ?? '     ';
    const right = textLines[index] ?? '';
    return ` ${padToWidth(left, 5)}  ${right}`;
  });
  return [renderRule(theme, width - 1), ...body, renderRule(theme, width - 1), ''].join(
    '\n',
  );
}
