/**
 * 文档目录导航的纯逻辑层（tocbot 模式提炼）。DOM 扫描与滚动监听在
 * 组件层；这里只放可离线测试的三件事：中文友好的 slug 化、重名去重、
 * scroll-spy 的激活判定。
 */

/** 生成标题锚点 id：保留 CJK 与字母数字，空白折叠为连字符，剥离符号。 */
export function slugifyHeading(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{Letter}\p{Number}_-]/gu, '')
      /* 符号剥离会留下连续/首尾连字符（如「A/B 测试 🚀」），统一收敛 */
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/** 重名去重：首次出现原样，之后追加 -2、-3……used 表原地更新。 */
export function dedupeSlug(slug: string, used: Map<string, number>): string {
  const count = used.get(slug) ?? 0;
  used.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count + 1}`;
}

/**
 * scroll-spy 激活判定（tocbot getTopHeader）：取第一个顶边越过
 * 「scrollTop + offset」的标题的**前一个**为当前章节——当前章节的
 * 标题允许已经滚出视口顶部；全部越过后取最后一个。
 */
export function pickActiveHeading(
  tops: number[],
  scrollTop: number,
  offsetPx = 10,
): number {
  if (tops.length === 0) return -1;
  for (let index = 0; index < tops.length; index += 1) {
    if (tops[index]! > scrollTop + offsetPx) {
      return Math.max(0, index === 0 ? 0 : index - 1);
    }
  }
  return tops.length - 1;
}
