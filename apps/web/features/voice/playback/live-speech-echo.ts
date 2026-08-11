export interface LiveSpeechEchoInput {
  readonly transcript: string;
  readonly assistantText: string | null;
  readonly assistantSubtitle: string | null;
  /** 仅在正在播音或播音刚结束的短窗口内启用，不能吞掉普通用户复述。 */
  readonly playbackRecentlyActive: boolean;
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function bigrams(value: string): Set<string> {
  const points = [...value];
  if (points.length < 2) return new Set(points);
  return new Set(
    points.slice(0, -1).map((point, index) => point + points[index + 1]),
  );
}

function diceSimilarity(left: string, right: string): number {
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

/**
 * 判断麦克风转写是否来自正在播放的 Assistant 音频。
 *
 * 先用当前字幕做局部比较，再按句末标点拆分完整回答；这样既能容忍 ASR 的
 * 少量同音字误差，也不会因为完整回答很长而稀释当前播报片段的相似度。
 */
export function isLikelyLivePlaybackEcho({
  transcript,
  assistantText,
  assistantSubtitle,
  playbackRecentlyActive,
}: LiveSpeechEchoInput): boolean {
  if (!playbackRecentlyActive) return false;
  const heard = normalize(transcript);
  if ([...heard].length < 3) return false;
  const candidates = [
    assistantSubtitle ?? '',
    ...(assistantText ?? '').split(/(?<=[。！？!?；;])/u),
  ]
    .map(normalize)
    .filter(Boolean);

  return candidates.some((candidate) => {
    const shorterLength = Math.min([...heard].length, [...candidate].length);
    if (
      shorterLength >= 4 &&
      (candidate.includes(heard) || heard.includes(candidate))
    ) {
      return true;
    }
    return diceSimilarity(heard, candidate) >= 0.62;
  });
}
