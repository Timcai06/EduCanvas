import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  readMode: vi.fn(),
  trustedOrigin: vi.fn(),
  transcribeAudio: vi.fn(),
  resolveGateway: vi.fn(),
}));

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.readIdentity,
}));
vi.mock('@/server/experience-mode', () => ({
  readExperienceMode: mocks.readMode,
}));
vi.mock('@/server/voice/dictation-gateway', () => ({
  resolveDictationGateway: mocks.resolveGateway,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/http/request-security')>()),
  isTrustedSameOriginWrite: mocks.trustedOrigin,
}));

import { POST } from './route';

function wav(): Uint8Array {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  write(0, 'RIFF');
  view.setUint32(4, 38, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, 2, true);
  return bytes;
}

function webm(): Uint8Array {
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
}

function request(bytes = wav(), contentType = 'audio/wav'): Request {
  return new Request('http://localhost/api/v1/voice/dictation', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': contentType },
    body: bytes.slice().buffer,
  });
}

describe('POST /api/v1/voice/dictation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue({ token: '', studentId: 'user:1' });
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveGateway.mockReturnValue({
      transcribeAudio: mocks.transcribeAudio,
    });
    mocks.transcribeAudio.mockResolvedValue({ text: '  可编辑草稿  ' });
  });

  it('只向浏览器返回严格 text，不返回 Provider metadata', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '可编辑草稿' });
    expect(mocks.transcribeAudio).toHaveBeenCalledOnce();
  });

  it('接受带 EBML 魔术字节的 WebM/Opus 并按 audio/webm 交给 Provider', async () => {
    const response = await POST(request(webm(), 'audio/webm;codecs=opus'));

    expect(response.status).toBe(200);
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        audioBytes: webm(),
        mimeType: 'audio/webm',
      }),
    );
  });

  it('拒绝伪造为 WebM 的任意字节', async () => {
    const response = await POST(
      request(Uint8Array.from([1, 2, 3, 4, 5]), 'audio/webm'),
    );

    expect(response.status).toBe(400);
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it('同源、登录、体验模式、格式和 WAV 结构均 fail closed', async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    mocks.readIdentity.mockResolvedValue({ token: '', studentId: 'user:1' });
    mocks.readMode.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(409);
    mocks.readMode.mockResolvedValue('restricted');
    expect((await POST(request(wav(), 'audio/ogg'))).status).toBe(415);
    expect((await POST(request(Uint8Array.from([1, 2])))).status).toBe(400);
  });

  it('Provider 失败只返回稳定错误，不泄漏异常', async () => {
    mocks.transcribeAudio.mockRejectedValue(new Error('sk-secret raw body'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
