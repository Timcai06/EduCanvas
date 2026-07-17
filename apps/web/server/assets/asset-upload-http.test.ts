import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let assetUploadErrorResponse: typeof import('./asset-upload-http').assetUploadErrorResponse;
let parseAssetUploadRequest: typeof import('./asset-upload-http').parseAssetUploadRequest;
let AssetUploadError: typeof import('./asset-upload').AssetUploadError;

beforeAll(async () => {
  ({ assetUploadErrorResponse, parseAssetUploadRequest } =
    await import('./asset-upload-http'));
  ({ AssetUploadError } = await import('./asset-upload'));
});

describe('asset upload HTTP boundary', () => {
  it('rejects non-multipart requests before reading the body', async () => {
    const response = await parseAssetUploadRequest(
      new Request('http://localhost/api/v1/assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(415);
    await expect((response as Response).json()).resolves.toMatchObject({
      error: { code: 'invalid_upload' },
    });
  });

  it('parses a valid file and scope', async () => {
    const form = new FormData();
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    form.set('file', file);
    form.set('scope', 'space');

    const parsed = await parseAssetUploadRequest(
      new Request('http://localhost/api/v1/assets', {
        method: 'POST',
        body: form,
      }),
    );

    expect(parsed).not.toBeInstanceOf(Response);
    expect((parsed as { file: File; scope: string }).scope).toBe('space');
    expect((parsed as { file: File }).file.name).toBe('note.txt');
    expect((parsed as { file: File }).file.size).toBe(5);
  });

  it('maps domain errors to stable public messages', async () => {
    const response = assetUploadErrorResponse(
      new AssetUploadError('file_too_large', 413),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'file_too_large', message: '文件不能超过10MB。' },
    });
  });
});
