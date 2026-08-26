import { describe, expect, it, vi } from 'vitest';
import {
  loadPicturebookBundle,
  projectPicturebookContent,
  readPicturebookPage,
} from './picturebook-bundle';

vi.mock('server-only', () => ({}));

const artifactId = '11111111-1111-4111-8111-111111111111';
const bundle = {
  contentVersion: 1 as const,
  pages: Array.from({ length: 6 }, (_, index) => ({
    imagePrompt: `private prompt ${index + 1}`,
    captionText: `第 ${index + 1} 页`,
    image: {
      contentType: 'image/png' as const,
      byteSize: 4,
      size: '512x512' as const,
      bytesBase64: Buffer.from([137, 80, 78, 71]).toString('base64'),
    },
  })),
};

describe('picturebook bundle projection', () => {
  it('校验私有 bundle 后只投影同源页地址与 caption', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const loaded = await loadPicturebookBundle({
      objectKey: 'artifacts/a/picturebook.json',
      checksum: 'a'.repeat(64),
      storage: { readVerified: vi.fn().mockResolvedValue(bytes) },
    });
    const content = projectPicturebookContent({
      artifactId,
      version: 1,
      bundle: loaded,
    });

    expect(content.pages).toHaveLength(6);
    expect(JSON.stringify(content)).not.toContain('private prompt');
    expect(content.pages[0]!.imageUrl).toBe(
      `/api/v1/chat/artifacts/${artifactId}/picturebook/pages/1?version=1`,
    );
    expect(readPicturebookPage(loaded, 1).bytes).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });
});
