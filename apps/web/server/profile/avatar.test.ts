import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { AvatarUploadError, detectAvatarImage } = await import('./avatar');

describe('avatar image detection', () => {
  it('detects supported image signatures', () => {
    expect(
      detectAvatarImage(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ mimeType: 'image/png', extension: 'png' });
    expect(detectAvatarImage(new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(
      detectAvatarImage(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('rejects unsupported files at the server boundary', () => {
    expect(() => detectAvatarImage(new Uint8Array([1, 2, 3, 4]))).toThrow(
      AvatarUploadError,
    );
  });
});
