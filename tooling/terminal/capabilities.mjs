/**
 * 终端能力探测 — 颜色/色深/宽度/CI/超链接支持的单一决策点。
 *
 * colorEnabled 语义（历史契约，调用方依赖，勿改）：
 * - NO_COLOR 一经设置（任意非空值）即禁用，优先于 FORCE_COLOR；
 * - FORCE_COLOR='0' 强制禁用；
 * - 非 TTY 一律无颜色。
 *
 * 静态模式（NO_COLOR / 非 TTY / CI）下调用方必须输出完全静态内容：
 * 无 ANSI、无动画、无 cursor movement。JSONL 永远是机器事实层。
 */

/**
 * 探测终端能力。stdout 可注入（测试用），env 默认取 process.env。
 * 返回 { isTTY, noColor, colorEnabled, colorDepth, isCI, isDumb, osc8, width }。
 */
export function detectTerminalCapabilities({
  stdout = process.stdout,
  env = process.env,
} = {}) {
  const isTTY = stdout?.isTTY === true;
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== '';
  const colorEnabled = isTTY && !noColor && env.FORCE_COLOR !== '0';
  const colorTerm = String(env.COLORTERM ?? '').toLowerCase();
  const colorDepth =
    colorTerm.includes('truecolor') || colorTerm.includes('24bit')
      ? 'rgb'
      : /256color/.test(String(env.TERM ?? ''))
        ? 'sgr256'
        : 'sgr16';
  const isCI = env.CI !== undefined && env.CI !== '';
  const isDumb = String(env.TERM ?? '') === 'dumb';
  const width =
    Number.isInteger(stdout?.columns) && stdout.columns > 0
      ? stdout.columns
      : 80;
  // OSC8 超链接只在 TTY 可用；非 TTY 一律退化为纯文本（见 ./links.mjs）。
  const osc8 = isTTY;
  return {
    isTTY,
    noColor,
    colorEnabled,
    colorDepth,
    isCI,
    isDumb,
    osc8,
    width,
  };
}
