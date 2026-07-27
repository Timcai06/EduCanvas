import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getAvatar: vi.fn(),
  updateAvatar: vi.fn(),
  readForm: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  removeByKey: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  readRegisteredSessionIdentity: vi.fn(async () => ({ userId: 'user:one' })),
}));
vi.mock('@/server/auth/account-repository', () => ({
  WebAccountRepository: class {
    getAvatar = mocks.getAvatar;
    updateAvatar = mocks.updateAvatar;
  },
}));
vi.mock('@/server/http/bounded-multipart', () => {
  class BoundedMultipartError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    BoundedMultipartError,
    readBoundedMultipartFormData: mocks.readForm,
  };
});
vi.mock('@/server/assets/asset-storage', () => ({
  readStoredAssetBytes: vi.fn(),
  storeAssetBytes: mocks.store,
  removeStoredAsset: mocks.remove,
  removeStoredAssetByKey: mocks.removeByKey,
}));

import { BoundedMultipartError } from '@/server/http/bounded-multipart';
import { POST } from './route';

function uploadRequest(): Request {
  return new Request('http://localhost/api/v1/me/avatar', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const form = new FormData();
  form.set(
    'avatar',
    new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'avatar.png',
      { type: 'image/png' },
    ),
  );
  mocks.readForm.mockResolvedValue(form);
  mocks.getAvatar.mockResolvedValue(null);
  mocks.store.mockResolvedValue({
    storageKey: 'assets/aaaaaaaaaaaaaaaa/new.png',
    absolutePath: '/tmp/new.png',
  });
  mocks.updateAvatar.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.removeByKey.mockResolvedValue(undefined);
});

describe('POST /api/v1/me/avatar', () => {
  it('在multipart硬上限命中时不创建对象', async () => {
    mocks.readForm.mockRejectedValue(
      new BoundedMultipartError('multipart_too_large'),
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(413);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it('数据库更新失败时补偿删除刚写入的对象', async () => {
    mocks.updateAvatar.mockRejectedValue(new Error('database_unavailable'));

    const response = await POST(uploadRequest());

    expect(response.status).toBe(503);
    expect(mocks.remove).toHaveBeenCalledWith({
      storageKey: 'assets/aaaaaaaaaaaaaaaa/new.png',
      absolutePath: '/tmp/new.png',
    });
  });

  it('替换成功后按受控key清理旧头像', async () => {
    mocks.getAvatar.mockResolvedValue({
      objectKey: 'assets/aaaaaaaaaaaaaaaa/old.png',
      mimeType: 'image/png',
    });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    expect(mocks.removeByKey).toHaveBeenCalledWith(
      'assets/aaaaaaaaaaaaaaaa/old.png',
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
