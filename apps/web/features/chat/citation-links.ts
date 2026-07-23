const CITATION_HREF_PREFIX = '#cite-';

/**
 * 把服务端已确认存在的正文引用标记改写为消息内锚点链接。
 * 未进入持久化引用投影的编号保持原文，浏览器不得自行扩大引用集合。
 */
export function linkifyCitationMarkers(
  text: string,
  markers: ReadonlySet<number>,
  anchorPrefix: string,
): string {
  if (markers.size === 0) return text;
  return text.replace(/\[(\d{1,2})\](?!\()/g, (raw, digits: string) => {
    const marker = Number(digits);
    return markers.has(marker)
      ? `[${marker}](${CITATION_HREF_PREFIX}${anchorPrefix}-${marker})`
      : raw;
  });
}

/** 判断 Markdown 链接是否属于 EduCanvas 消息内的可信引用锚点。 */
export function isCitationAnchor(href: string | undefined): href is string {
  return href?.startsWith(CITATION_HREF_PREFIX) ?? false;
}
