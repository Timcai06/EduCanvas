import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  conversation: vi.fn(),
  trustedOrigin: vi.fn(),
  importAsset: vi.fn(),
}));

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.identity,
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: mocks.conversation,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/http/request-security')>();
  return { ...original, isTrustedSameOriginWrite: mocks.trustedOrigin };
});
vi.mock('@/server/assets/asset-upload', () => ({
  AssetUploadError: class AssetUploadError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
    ) {
      super(code);
    }
  },
  importOwnedLinkAsset: mocks.importAsset,
}));

import { AssetUploadError } from '@/server/assets/asset-upload';
import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/v1/chat/assets/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/chat/assets/link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.identity.mockResolvedValue({ studentId: 'student-1' });
    mocks.conversation.mockResolvedValue({ spaceId: 'space-1' });
  });

  it('maps the legacy extractor error to a stable actionable error', async () => {
    mocks.importAsset.mockRejectedValue(
      new AssetUploadError('link_unsupported_content', 422),
    );

    const response = await POST(request({ url: 'https://example.com' }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'link_no_extractable_content',
        retryable: false,
        message: '网页没有可提取的正文。请保存为 PDF 后上传。',
      },
    });
  });

  it('returns fake_ip_dns_detected with retryable=false and safe Chinese message', async () => {
    mocks.importAsset.mockRejectedValue(
      new AssetUploadError('fake_ip_dns_detected', 422),
    );

    const response = await POST(request({ url: 'https://example.com' }));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: 'fake_ip_dns_detected',
        retryable: false,
        message:
          '当前网络代理使用 Fake-IP DNS，无法安全验证网页地址。请切换到 Redir-Host/真实 IP 模式后重试。',
      },
    });
  });
});
