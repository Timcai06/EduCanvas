/**
 * DESIGN.md 第 6 节动效时长 token 的运行时读取器。
 * globals.css 的 @theme（--duration-*）是唯一事实源；GSAP 需要秒数，
 * 这里做一次 ms→s 换算。仅状态迁移（面板/列表/菜单/遮罩）经此消费 token；
 * 扉页与 Studio 的组合入场、氛围循环的时长是效果内在参数，不经此读取。
 * 读取失败（SSR/极端环境）回落到 token 标称值兜底，不另立标准。
 */
export type MotionDurationToken =
  'instant' | 'micro' | 'fast' | 'standard' | 'emphasis' | 'slow' | 'hero';

const FALLBACK_SECONDS: Record<MotionDurationToken, number> = {
  instant: 0.12,
  micro: 0.16,
  fast: 0.22,
  standard: 0.3,
  emphasis: 0.42,
  slow: 0.52,
  hero: 0.9,
};

export function motionDuration(token: MotionDurationToken): number {
  if (typeof document === 'undefined') return FALLBACK_SECONDS[token];
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--duration-${token}`)
    .trim();
  if (raw.endsWith('ms')) {
    const ms = Number.parseFloat(raw);
    if (Number.isFinite(ms)) return ms / 1000;
  } else if (raw.endsWith('s')) {
    const seconds = Number.parseFloat(raw);
    if (Number.isFinite(seconds)) return seconds;
  }
  return FALLBACK_SECONDS[token];
}
