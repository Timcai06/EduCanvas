import type { DesktopResultTarget } from '../../shared/chat-history';

export async function openDesktopResult(
  target: DesktopResultTarget,
): Promise<string> {
  const result = await window.desktopResult.open(target);
  return result.ok ? '已在 EduCanvas Web 中打开。' : result.message;
}
