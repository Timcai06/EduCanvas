import { describe, expect, it } from 'vitest';
import { assetPreviewSchema } from './asset-preview-contract';

describe('assetPreviewSchema', () => {
  it('accepts only bounded same-origin projections', () => {
    expect(
      assetPreviewSchema.safeParse({
        kind: 'pdf',
        fileName: 'lesson.pdf',
        mimeType: 'application/pdf',
        fileUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file',
      }).success,
    ).toBe(true);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'pdf',
        fileName: 'lesson.pdf',
        mimeType: 'application/pdf',
        fileUrl: 'https://storage.example/secret-key',
      }).success,
    ).toBe(false);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'markdown',
        fileName: 'large.md',
        mimeType: 'text/markdown',
        content: 'x'.repeat(120_001),
      }).success,
    ).toBe(false);
  });
});
