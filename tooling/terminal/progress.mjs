/**
 * 进度动画基础 — 首个 PR 只提供 spinner 帧，不启用动画。
 *
 * 纪律（后续动画里程碑必须遵守）：只有 running 状态可动画；
 * ready/completed/stopped/failed 一律静态；NO_COLOR/non-TTY/CI
 * 下不得输出任何 cursor movement/动画序列。
 */

export const SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
];

/** 取第 step 帧（负数/超界安全取模）。 */
export function spinnerFrame(step) {
  const index = Math.abs(step) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[index];
}
