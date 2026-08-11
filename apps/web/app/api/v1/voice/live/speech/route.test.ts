import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  readMode: vi.fn(),
  resolveGateway: vi.fn(),
  trustedOrigin: vi.fn(),
}));

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.readIdentity,
}));
vi.mock('@/server/experience-mode', () => ({
  readExperienceMode: mocks.readMode,
}));
vi.mock('@educanvas/model-gateway', () => ({
  resolveDashScopeStreamingSpeechGateway: mocks.resolveGateway,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/http/request-security')>()),
  isTrustedSameOriginWrite: mocks.trustedOrigin,
}));

import { POST } from './route';

function request(text = '你好。'): Request {
  return new Request('http://localhost/api/v1/voice/live/speech', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
}

describe('POST /api/v1/voice/live/speech', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue({ token: '', studentId: 'user:1' });
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveGateway.mockReturnValue({
      async *streamSpeech() {
        yield {
          type: 'audio' as const,
          sequence: 0,
          pcmBytes: Uint8Array.from([1, 2, 3, 4]),
        };
        yield { type: 'finished' as const };
      },
    });
  });

  it('只流式返回 24 kHz mono PCM，不暴露 Provider metadata', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'audio/L16; rate=24000; channels=1',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
  });

  it('同源、登录、体验模式和 Provider 配置均 fail closed', async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    mocks.readIdentity.mockResolvedValue({ token: '', studentId: 'user:1' });
    mocks.readMode.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(409);
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveGateway.mockReturnValue(null);
    expect((await POST(request())).status).toBe(503);
  });

  it('Provider 流失败时只终止音频流，不回显异常内容', async () => {
    mocks.resolveGateway.mockReturnValue({
      async *streamSpeech() {
        yield { type: 'failed' as const, failureCode: 'MODEL_FAILED' as const };
      },
    });
    const response = await POST(request('不会泄漏 sk-secret'));
    await expect(response.arrayBuffer()).rejects.not.toThrow(/sk-secret/);
  });
});
