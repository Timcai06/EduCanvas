import { describe, expect, it } from 'vitest';
import { isCitationAnchor, linkifyCitationMarkers } from './citation-links';

describe('citation links', () => {
  it('只改写服务端确认的引用标记', () => {
    expect(
      linkifyCitationMarkers(
        '第一条结论 [1]，未使用的候选 [2]。',
        new Set([1]),
        'assistant-1',
      ),
    ).toBe('第一条结论 [1](#cite-assistant-1-1)，未使用的候选 [2]。');
  });

  it('不改写 Markdown 链接或没有服务端投影的编号', () => {
    expect(
      linkifyCitationMarkers(
        '普通编号 [1] 与 [来源](https://example.com)',
        new Set(),
        'assistant-1',
      ),
    ).toBe('普通编号 [1] 与 [来源](https://example.com)');
  });

  it('只识别消息内引用锚点', () => {
    expect(isCitationAnchor('#cite-assistant-1-1')).toBe(true);
    expect(isCitationAnchor('https://example.com')).toBe(false);
    expect(isCitationAnchor(undefined)).toBe(false);
  });
});
