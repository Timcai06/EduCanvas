import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { extractCitationMarkers } = await import('./citation-markers');

describe('extractCitationMarkers', () => {
  it('提取范围内标记,升序去重', () => {
    expect(
      extractCitationMarkers('猫的耳朵是尖的 [2],狗则下垂 [1]。再看 [2]。', 3),
    ).toEqual([1, 2]);
  });

  it('忽略越界号码、Markdown 链接与非标记方括号', () => {
    expect(
      extractCitationMarkers('参考 [5] 与 [链接](https://x) 以及 [0],还有 [1](http://y)。', 3),
    ).toEqual([]);
  });

  it('无标记返回空(调用方回退全量引用)', () => {
    expect(extractCitationMarkers('没有任何引用标记。', 4)).toEqual([]);
    expect(extractCitationMarkers('[1]', 0)).toEqual([]);
  });
});
