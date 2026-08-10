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
  issueVoiceStreamingTicket: mocks.issueTicket,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/http/request-security')>();
  return { ...original, isTrustedSameOriginWrite: mocks.trustedOrigin };
});

import { POST } from './route';

const healthyChecks = [
  { key: 'model', healthy: true },
  { key: 'connection', healthy: true },
];

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/voice/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/voice/tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.readIdentity.mockResolvedValue({ token: '', studentId: 'user:1' });
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveCapability.mockResolvedValue({
      checks: healthyChecks,
      websocketUrl: 'ws://localhost:3200/v1/client/streaming-transcription',
    });
    mocks.issueTicket.mockResolvedValue({
      ticket: 'short-ticket',
      expiresAt: '2026-08-10T00:01:00.000Z',
    });
  });

  it('每次签发前重新校验能力并只返回短时 ticket', async () => {
    const response = await POST(request({ notebookId: 'notebook:1' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ticket: 'short-ticket',
      expiresAt: '2026-08-10T00:01:00.000Z',
    });
    expect(mocks.resolveCapability).toHaveBeenCalledWith();
    expect(mocks.issueTicket).toHaveBeenCalledWith({
      subjectUserId: 'user:1',
      notebookId: 'notebook:1',
    });
  });

  it('实时基础设施不可用时 fail closed，不调用 Gateway', async () => {
    mocks.resolveCapability.mockResolvedValue({
      checks: healthyChecks.map((check) =>
        check.key === 'connection' ? { ...check, healthy: false } : check,
      ),
      websocketUrl: null,
    });
    const response = await POST(request({ notebookId: 'notebook:1' }));
    expect(response.status).toBe(503);
    expect(mocks.issueTicket).not.toHaveBeenCalled();
  });

  it('尚未选择模式时在能力查询前拒绝', async () => {
    mocks.readMode.mockResolvedValue(null);
    const response = await POST(request({ notebookId: 'notebook:1' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'experience_mode_required' },
    });
    expect(mocks.resolveCapability).not.toHaveBeenCalled();
    expect(mocks.issueTicket).not.toHaveBeenCalled();
  });

  it('匿名身份与跨站写入均在能力查询前拒绝', async () => {
    mocks.readIdentity.mockResolvedValue({
      token: 'anonymous',
      studentId: 'anon:v1:student',
    });
    expect((await POST(request({ notebookId: 'notebook:1' }))).status).toBe(
      401,
    );
    mocks.trustedOrigin.mockReturnValue(false);
    expect((await POST(request({ notebookId: 'notebook:1' }))).status).toBe(
      403,
    );
    expect(mocks.resolveCapability).not.toHaveBeenCalled();
  });
});
