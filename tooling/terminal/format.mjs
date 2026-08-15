/**
 * 终端文本格式化 — 显示宽度/对齐/截断/时长/路径缩写。
 *
 * displayWidth 遵循 East Asian Wide 判定（中文按 2 格），与
 * packages/logging/src/pretty-renderer.ts 中的实现保持等价
 * （tooling-parity.test.ts 锁定两侧输出一致）。
 */

/** CJK 及其他宽字符按 2 格计算显示宽度；其余按 1。 */
export function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width +=
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd))
        ? 2
        : 1;
  }
  return width;
}

/** 按显示宽度填充到目标宽度（中文正确处理）。 */
export function padDisplay(text, width) {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + ' '.repeat(padding) : text;
}

/** 截断到显示宽度上限（避免破坏中文字符），超宽时以 … 结尾。 */
export function truncateDisplay(text, width) {
  let current = 0;
  let index = 0;
  for (const char of [...text]) {
    const charWidth = displayWidth(char);
    if (current + charWidth > width) break;
    current += charWidth;
    index += 1;
  }
  const chars = [...text];
  return index < chars.length ? `${chars.slice(0, index).join('')}…` : text;
}

/** 人类可读时长：<1s → ms；<60s → 秒（两位小数）；否则 Xm Ys。 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * 仓库内路径显示为仓库相对路径（日志目录等）；仓库外路径保持完整
 * 绝对路径（失败摘要需要精确位置，调用方自行决定是否缩写）。
 */
export function shortenPath(directory, { cwd = process.cwd() } = {}) {
  if (typeof directory !== 'string' || directory === '') return directory;
  const normalized = directory.replaceAll('\\', '/');
  const base = cwd.replaceAll('\\', '/');
  if (normalized === base) return '.';
  if (normalized.startsWith(`${base}/`))
    return normalized.slice(base.length + 1);
  return directory;
}
