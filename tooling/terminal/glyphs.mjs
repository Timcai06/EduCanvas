/**
 * 终端字形系统 — 状态标记与装饰符号的单一事实源。
 *
 * 原则：符号是文字的补充而非替代——成功/失败永远同时有符号与文字，
 * 禁止只用颜色/符号传达状态。ANSI 不存在于本模块（符号是普通字符）。
 */

export const GLYPHS = {
  /** 品牌标记（标题行）。 */
  brand: '◆',
  ok: '✓',
  warn: '!',
  fail: '×',
  dot: '·',
  chevron: '›',
  indent: '↳',
  branch: '│',
  rule: '─',
  ellipsis: '…',
};

/** 摘要分隔线（56 列，与历史输出一致）。 */
export const SUMMARY_RULE = '─'.repeat(56);
