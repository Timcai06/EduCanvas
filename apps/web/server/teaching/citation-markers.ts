import 'server-only';

/**
 * 从最终回答文本中提取模型实际标注的引用标记(M3c:synthesis 实际引用子集)。
 * 规则:匹配独立的 [n](后面不能紧跟 "(",避开 Markdown 链接语法),
 * 只保留 1..candidateCount 范围内的号码,按数值升序去重。
 * 返回空数组表示模型未按标记引用——调用方回退为"全部候选皆引用"的旧行为,
 * 引用宁多勿丢。
 */
export function extractCitationMarkers(
  text: string,
  candidateCount: number,
): readonly number[] {
  if (candidateCount < 1) return [];
  const found = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,2})\](?!\()/g)) {
    const marker = Number(match[1]);
    if (marker >= 1 && marker <= candidateCount) found.add(marker);
  }
  return [...found].sort((left, right) => left - right);
}
