export type SelfMark = 'got' | 'missed';

export type FlashcardAction = 'flip' | 'got' | 'missed' | null;

/**
 * 键盘动作矩阵（纯函数）：Space/Enter 恒翻面；数字键 1/2 只在翻开后
 * 生效——没看到答案就评分是无效输入。输入框聚焦的守卫在渲染器层，
 * 这里只管「当前翻面态 → 该按键语义」。
 */
export function resolveFlashcardAction(
  key: string,
  flipped: boolean,
): FlashcardAction {
  if (key === ' ' || key === 'Enter') return 'flip';
  if (!flipped) return null;
  if (key === '1') return 'missed';
  if (key === '2') return 'got';
  return null;
}

/**
 * Fisher-Yates 本地洗牌：只重排渲染顺序，不改 cards 数据本身。
 * rng 注入便于测试（默认 Math.random）。
 */
export function createShuffledOrder(
  count: number,
  rng: () => number = Math.random,
): number[] {
  const next = Array.from({ length: count }, (_, i) => i);
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

/** 自评记账（纯函数）：marks 以卡 id 为键，重复评分覆盖旧值。 */
export function applyMark(
  marks: Record<string, SelfMark>,
  cardId: string,
  value: SelfMark,
): Record<string, SelfMark> {
  return { ...marks, [cardId]: value };
}

export function countMarks(
  marks: Record<string, SelfMark>,
  value: SelfMark,
): number {
  return Object.values(marks).filter((mark) => mark === value).length;
}
