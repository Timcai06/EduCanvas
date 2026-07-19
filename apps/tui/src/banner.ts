import { padToWidth, stringWidth, truncateToWidth } from './text';
import type { TuiTheme } from './theme';

/**
 * 扉页：进入 TUI 或切换笔记本时的「翻开笔记本」时刻。
 * 视觉主体是一枚朱砂印章（品牌标记，与 Web 的 LogoMark 同源）+ 笔记本信息。
 * 窄终端（< 46 列）自动降级为单行标题，装饰永远先于信息退场。
 */

export interface BannerInfo {
  /** 笔记本标题；null 显示为未命名。 */
  title: string | null;
  /** 印章右侧的补充行（如会话状态、可用命令提示），最多两行。 */
  detailLines?: readonly string[];
}

const COMPACT_WIDTH = 46;

/** 朱砂印章的三行块字。宽度 5 列，无色环境仍是可辨认的方章。 */
function sealLines(theme: TuiTheme): readonly string[] {
  return [
    theme.zhusha('▛▀▀▀▜'),
    theme.zhusha('▌ ') + theme.zhusha('✓') + theme.zhusha(' ▐'),
    theme.zhusha('▙▄▄▄▟'),
  ];
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
  const textWidth = width - 8;
  const textLines = [
    `${theme.bold('EduCanvas')} ${theme.dim('·')} ${truncateToWidth(title, Math.max(8, textWidth - 12))}`,
    ...(info.detailLines ?? []).map((line) =>
      theme.dim(truncateToWidth(line, textWidth)),
    ),
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
