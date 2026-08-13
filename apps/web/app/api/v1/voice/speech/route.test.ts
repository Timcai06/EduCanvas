import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  readMode: vi.fn(),
  trustedOrigin: vi.fn(),
  resolveGateway: vi.fn(),
  generateSpeech: vi.fn(),
}));

vi.mock('@/server/auth/request-identity', () => ({
  readAuthenticatedRequestIdentity: mocks.readIdentity,
}));
vi.mock('@/server/experience-mode', () => ({
  readExperienceMode: mocks.readMode,
}));
vi.mock('@/server/voice/speech-gateway', () => ({
  resolveSpeechGateway: mocks.resolveGateway,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/http/request-security')>()),
  isTrustedSameOriginWrite: mocks.trustedOrigin,
}));

import { POST } from './route';

function request(text = '答案是四。', signal?: AbortSignal): Request {
  return new Request('http://localhost/api/v1/voice/speech', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal,
  });
}

describe('POST /api/v1/voice/speech', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue({ userId: 'user:1', source: 'web' });
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveGateway.mockReturnValue({
      generateSpeech: mocks.generateSpeech,
    });
    mocks.generateSpeech.mockResolvedValue({
      bytes: Uint8Array.from([0x49, 0x44, 0x33, 0x04]),
      contentType: 'audio/mpeg',
      metadata: { provider: 'fixture-secret-provider' },
    });
  });

  it('只返回 MP3 字节，不暴露 Provider metadata', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([0x49, 0x44, 0x33, 0x04]),
    );
  });

  it('桌面 bearer 主体不依赖浏览器的体验模式 Cookie', async () => {
    mocks.readIdentity.mockResolvedValue({
      userId: 'user:desktop',
      source: 'desktop',
    });
    mocks.readMode.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.readMode).not.toHaveBeenCalled();
  });

  it('同源、登录、体验模式、文本和 Provider 配置均 fail closed', async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    mocks.readIdentity.mockResolvedValue({ userId: 'user:1', source: 'web' });
    mocks.readMode.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(409);
    mocks.readMode.mockResolvedValue('restricted');
    expect((await POST(request('   '))).status).toBe(400);
    mocks.resolveGateway.mockReturnValue(null);
    expect((await POST(request())).status).toBe(503);
  });

  it('把请求取消信号传给 TTS Port', async () => {
    const controller = new AbortController();
    const pending = POST(request('请读出来', controller.signal));
    controller.abort();
    await pending;

    expect(mocks.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.generateSpeech.mock.calls[0]![0].signal.aborted).toBe(true);
  });

  it('Provider 失败只返回稳定错误，不泄漏异常', async () => {
    mocks.generateSpeech.mockRejectedValue(new Error('sk-secret raw body'));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
