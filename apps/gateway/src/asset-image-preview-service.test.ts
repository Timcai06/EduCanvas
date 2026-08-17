import { describe, expect, it, vi } from 'vitest';
import {
  GatewayImagePreviewError,
  GatewayImagePreviewService,
} from './asset-image-preview-service';

describe('GatewayImagePreviewService', () => {
  const input = {
    conversationId: 'conversation:one',
    trustedSubjectId: 'user:one',
    assetId: 'asset:one',
    assetVersionId: 'version:one',
  };

  it('returns only an owned image part as a bounded preview', async () => {
    const find = vi.fn().mockResolvedValue({
      storageKey:
        'assets/aaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000001.png',
      mimeType: 'image/png',
      byteSize: 3,
    });
    const readBytes = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
    const service = new GatewayImagePreviewService({ find, readBytes });

    await expect(service.read(input)).resolves.toEqual({
      mimeType: 'image/png',
      bytes: Buffer.from([1, 2, 3]),
    });
    expect(find).toHaveBeenCalledWith(input);
  });

  it('rejects oversized or unsupported images before reading storage', async () => {
    const find = vi.fn().mockResolvedValue({
      storageKey:
        'assets/aaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000001.svg',
      mimeType: 'image/svg+xml',
      byteSize: 3,
    });
    const readBytes = vi.fn();
    const service = new GatewayImagePreviewService({ find, readBytes });

    await expect(service.read(input)).rejects.toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_MEDIA',
    } satisfies Partial<GatewayImagePreviewError>);
    expect(readBytes).not.toHaveBeenCalled();
  });

  it('preserves a storage read limit instead of loading an oversized object', async () => {
    const find = vi.fn().mockResolvedValue({
      storageKey:
        'assets/aaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000001.png',
      mimeType: 'image/png',
      byteSize: 3,
    });
    const readBytes = vi
      .fn()
      .mockRejectedValue(
        new GatewayImagePreviewError(413, 'PREVIEW_TOO_LARGE'),
      );
    const service = new GatewayImagePreviewService({ find, readBytes });

    await expect(service.read(input)).rejects.toMatchObject({
      status: 413,
      code: 'PREVIEW_TOO_LARGE',
    } satisfies Partial<GatewayImagePreviewError>);
  });
});
