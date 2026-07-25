export const GENERATED_SOFT_CLICK = 'generated:soft-click';

/**
 * 合成短促的轻点声，避免为一次 UI 反馈引入外部音频、网络请求或版权不明资产。
 * 必须由滚轮、指针或键盘事件触发，以遵守浏览器的音频播放权限边界。
 */
export function playSoftClick(
  currentContext: AudioContext | null,
  volume: number,
): AudioContext {
  const context = currentContext ?? new AudioContext();
  if (context.state === 'suspended') void context.resume();

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const safeVolume = Math.min(Math.max(volume, 0), 1);

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(620, now);
  oscillator.frequency.exponentialRampToValueAtTime(390, now + 0.045);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(safeVolume * 0.12, 0.0001),
    now + 0.003,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.055);

  return context;
}
