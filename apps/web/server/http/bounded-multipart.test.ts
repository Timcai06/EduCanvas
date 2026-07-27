import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let readBoundedMultipartFormData: typeof import('./bounded-multipart').readBoundedMultipartFormData;

beforeAll(async () => {
  ({ readBoundedMultipartFormData } = await import('./bounded-multipart'));
});

describe('bounded multipart reader', () => {
  it('在解析前拒绝声明超过硬上限的请求', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test',
        'content-length': '1025',
      },
      body: '--test--',
    });

    await expect(readBoundedMultipartFormData(request, 1024)).rejects.toEqual(
      expect.objectContaining({ code: 'multipart_too_large' }),
    );
  });

  it('缺少Content-Length时仍按实际流大小中止', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: new Uint8Array(1025),
    });

    await expect(readBoundedMultipartFormData(request, 1024)).rejects.toEqual(
      expect.objectContaining({ code: 'multipart_too_large' }),
    );
  });

  it('在硬上限内解析表单', async () => {
    const form = new FormData();
    form.set('avatar', new File(['png'], 'avatar.png', { type: 'image/png' }));
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: form,
    });

    const parsed = await readBoundedMultipartFormData(request, 4096);

    expect(parsed.get('avatar')).toBeInstanceOf(File);
  });
});
