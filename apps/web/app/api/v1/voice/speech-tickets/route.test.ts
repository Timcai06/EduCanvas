import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  readMode: vi.fn(),
  resolveCapability: vi.fn(),
  issueTicket: vi.fn(),
  trustedOrigin: vi.fn(() => true),
}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.readIdentity,
}));
vi.mock('@/server/experience-mode', () => ({
  readExperienceMode: mocks.readMode,
}));
vi.mock('@/server/voice/voice-capability', () => ({
  resolveVoiceCapability: mocks.resolveCapability,
}));
vi.mock('@/server/voice/voice-gateway-client', () => ({
  VoiceGatewayError: class VoiceGatewayError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  issueVoiceSpeechTicket: mocks.issueTicket,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/http/request-security')>();
  return { ...original, isTrustedSameOriginWrite: mocks.trustedOrigin };
});

import { POST } from './route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/voice/speech-tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/voice/speech-tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue({ studentId: 'user:1' });
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveCapability.mockResolvedValue({
      checks: [
        { key: 'model', healthy: true },
        { key: 'connection', healthy: true },
        { key: 'speech', healthy: true },
      ],
    });
    mocks.issueTicket.mockResolvedValue({
      ticket: 'speech-ticket',
      expiresAt: '2026-08-12T00:01:00.000Z',
    });
  });

  it('在同源、身份、模式和完整 Live 能力通过后签发 scoped ticket', async () => {
    const response = await POST(request({ notebookId: 'notebook:1' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ticket: 'speech-ticket',
      expiresAt: '2026-08-12T00:01:00.000Z',
    });
    expect(mocks.issueTicket).toHaveBeenCalledWith({
      subjectUserId: 'user:1',
      notebookId: 'notebook:1',
    });
  });

  it('任一 Live 能力失败时 fail closed 且不请求 Gateway', async () => {
    mocks.resolveCapability.mockResolvedValue({
      checks: [
        { key: 'model', healthy: true },
        { key: 'connection', healthy: true },
        { key: 'speech', healthy: false },
      ],
    });
    const response = await POST(request({ notebookId: 'notebook:1' }));
    expect(response.status).toBe(503);
    expect(mocks.issueTicket).not.toHaveBeenCalled();
  });

  it('跨站与匿名请求在能力查询前拒绝', async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    expect((await POST(request({ notebookId: 'notebook:1' }))).status).toBe(
      403,
    );
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue({ studentId: 'anon:v1:student' });
    expect((await POST(request({ notebookId: 'notebook:1' }))).status).toBe(
      401,
    );
    expect(mocks.resolveCapability).not.toHaveBeenCalled();
  });
});
