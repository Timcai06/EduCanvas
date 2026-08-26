import { describe, expect, it } from 'vitest';
import { projectRenderableArtifact } from '../grading';
import { picturebookContentSchema, picturebookPlanSchema } from './picturebook';

const artifactId = '11111111-1111-4111-8111-111111111111';
const pages = Array.from({ length: 6 }, (_, index) => ({
  imagePrompt: `same fox explores number ${index + 1}`,
  captionText: `小狐狸发现了第 ${index + 1} 个线索。`,
  imageUrl: `/api/v1/chat/artifacts/${artifactId}/picturebook/pages/${index + 1}?version=1`,
}));

describe('picturebook protocol', () => {
  it('只接受 6 到 8 页的严格分页计划', () => {
    expect(
      picturebookPlanSchema.parse({
        pages: pages.map(({ imagePrompt, captionText }) => ({
          imagePrompt,
          captionText,
        })),
      }).pages,
    ).toHaveLength(6);
    expect(
      picturebookPlanSchema.safeParse({ pages: pages.slice(0, 5) }).success,
    ).toBe(false);
  });

  it('公开投影剥离每页 imagePrompt', () => {
    const projected = projectRenderableArtifact({
      schemaVersion: '1',
      artifactId,
      type: 'picturebook',
      title: '小狐狸认识平均数',
      params: { pages },
    });

    expect(projected.type).toBe('picturebook');
    expect(JSON.stringify(projected)).not.toContain('imagePrompt');
    if (projected.type === 'picturebook') {
      expect(projected.params.pages[0]).toEqual({
        captionText: pages[0]!.captionText,
        imageUrl: pages[0]!.imageUrl,
      });
    }
  });

  it('拒绝外部图片地址', () => {
    expect(
      picturebookContentSchema.safeParse({
        contentVersion: 1,
        pages: pages.map((page) => ({
          captionText: page.captionText,
          imageUrl: 'https://example.com/image.png',
        })),
      }).success,
    ).toBe(false);
  });
});
