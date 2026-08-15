/**
 * OSC8 终端超链接 — 只在显式启用时输出，非 TTY/降级场景一律纯文本。
 *
 * URL 一律先净化控制字符（\x1b 等），防止终端注入；只接受 http/https，
 * 其他 scheme 直接退化为纯文本（不编造链接语义）。
 */

export function hyperlink(text, url, { enabled = false } = {}) {
  if (!enabled || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return text;
  }
  const clean = url.replace(/[\x00-\x1f\x7f]/g, '');
  return `\x1b]8;;${clean}\x1b\\${text}\x1b]8;;\x1b\\`;
}
