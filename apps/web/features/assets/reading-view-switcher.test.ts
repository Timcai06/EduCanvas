import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveQualityNote } from './reading-view-switcher';

const source = readFileSync(
  fileURLToPath(new URL('./reading-view-switcher.tsx', import.meta.url)),
  'utf8',
);

describe('resolveQualityNote', () => {
  it('四种质量状态返回一行提示与色调', () => {
    expect(
      resolveQualityNote({ quality: 'processing' }),
    ).toMatchObject({ tone: 'info' });
    expect(resolveQualityNote({ quality: 'failed' })).toMatchObject({
      text: '结构化转换失败；仍可预览原件。',
      tone: 'error',
    });
    expect(
      resolveQualityNote({ quality: 'degraded_plain_text' })?.text,
    ).toContain('降级为纯文本');
    expect(
      resolveQualityNote({ quality: 'unavailable' })?.text,
    ).toContain('仍可查看原件');
  });

  it('无质量状态或可读状态不产生提示', () => {
    expect(resolveQualityNote(null)).toBeNull();
    expect(resolveQualityNote({ quality: 'structured' })).toBeNull();
  });
});

describe('ReadingViewSwitcher 提示条边界', () => {
  it('提示是文档流外底部浮动胶囊：不占原件高度、可关闭、quality 变化重置', () => {
    expect(source).toContain('absolute bottom-4 left-1/2');
    expect(source).toContain('-translate-x-1/2');
    expect(source).toContain('aria-label="关闭提示"');
    expect(source).toContain('dismissedQuality');
    expect(source).toContain('role="status"');
    expect(source).not.toContain('shrink-0 px-4 pb-4');
  });

  it('提示文案与派生正文仍不混入 Canvas 内容', () => {
    expect(source).not.toContain('fetchArtifactDetail');
    expect(source).not.toContain('objectKey');
  });
});
