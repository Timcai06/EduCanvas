import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  conversation: vi.fn(),
  trustedOrigin: vi.fn(),
  importAsset: vi.fn(),
  trafficAcquire: vi.fn(),
  release: vi.fn(),
  telemetry: vi.fn(),
  metricIncrement: vi.fn(),
  metricRecord: vi.fn(),
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
vi.mock('@/server/assets/link-traffic-limiter', () => ({
  linkTrafficKey: (subject: string, notebook: string) =>
    `${subject}:${notebook}`,
  linkTrafficLimiter: { acquire: mocks.trafficAcquire },
}));
vi.mock('@/server/telemetry/telemetry-runtime', () => ({
  getWebTelemetryRuntime: mocks.telemetry,
}));

import { AssetUploadError } from '@/server/assets/asset-upload';
import { POST } from './route';

function request(body: unknown, signal?: AbortSignal) {
  return new Request('http://localhost/api/v1/chat/assets/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
    signal,
  });
}

describe('POST /api/v1/chat/assets/link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.identity.mockResolvedValue({ studentId: 'student-1' });
    mocks.conversation.mockResolvedValue({ spaceId: 'space-1' });
    mocks.trafficAcquire.mockReturnValue({
      allowed: true,
      release: mocks.release,
    });
    mocks.telemetry.mockReturnValue({
      metrics: {
        increment: mocks.metricIncrement,
        record: mocks.metricRecord,
      },
    });
  });

  it('maps the legacy extractor error to a stable actionable error', async () => {
    mocks.importAsset.mockRejectedValue(
      new AssetUploadError('link_unsupported_content', 422),
    );

    const response = await POST(request({ url: 'https://example.com' }));

    expect(response.status).toBe(422);
    expect(mocks.release).toHaveBeenCalledTimes(1);
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

  it('shares a stable 429 response when the actor and Notebook budget is full', async () => {
    mocks.trafficAcquire.mockReturnValue({
      allowed: false,
      reason: 'rate',
      retryAfterMs: 10_000,
    });

    const response = await POST(request({ url: 'https://example.com' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('10');
    expect(await response.json()).toEqual({
      error: {
        code: 'link_rate_limited',
        message: '网页暂时限制了访问。请稍后重试。',
        retryable: true,
      },
    });
    expect(mocks.importAsset).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('maps unknown import failures to a stable public error', async () => {
    mocks.importAsset.mockRejectedValue(new Error('secret provider body'));

    const response = await POST(request({ url: 'https://example.com' }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: 'link_import_unavailable',
        message: '暂时无法导入该网页。请稍后重试。',
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret provider body');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('passes the request signal into the direct import boundary', async () => {
    const controller = new AbortController();
    const importedRequest = request(
      { url: 'https://example.com' },
      controller.signal,
    );

    await POST(importedRequest);

    expect(mocks.importAsset).toHaveBeenCalledWith(
      expect.objectContaining({ signal: importedRequest.signal }),
    );
  });

  it('keeps imports available when telemetry initialization fails', async () => {
    mocks.telemetry.mockImplementation(() => {
      throw new Error('telemetry configuration invalid');
    });
    mocks.importAsset.mockResolvedValue({ id: 'asset-1' });

    const response = await POST(request({ url: 'https://example.com' }));

    expect(response.status).toBe(201);
    expect(mocks.importAsset).toHaveBeenCalledTimes(1);
  });
});
