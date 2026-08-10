import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  trustedOrigin: vi.fn(() => true),
  writeMode: vi.fn(),
}));

vi.mock('@/server/experience-mode', () => ({
  writeExperienceMode: mocks.writeMode,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/http/request-security')>();
  return { ...original, isTrustedSameOriginWrite: mocks.trustedOrigin };
});

import { POST } from './route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/experience-mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/experience-mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
  });

  it('限制模式无需监护人确认即可保存', async () => {
    const response = await POST(request({ mode: 'restricted' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: 'restricted' });
    expect(mocks.writeMode).toHaveBeenCalledWith('restricted');
  });

  it('通用模式仅在显式确认后保存', async () => {
    const rejected = await POST(request({ mode: 'general' }));
    expect(rejected.status).toBe(400);
    expect(mocks.writeMode).not.toHaveBeenCalled();

    const accepted = await POST(
      request({ mode: 'general', guardianConfirmed: true }),
    );
    expect(accepted.status).toBe(200);
    expect(mocks.writeMode).toHaveBeenCalledWith('general');
  });

  it('跨站选择请求被拒绝', async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    const response = await POST(request({ mode: 'restricted' }));
    expect(response.status).toBe(403);
    expect(mocks.writeMode).not.toHaveBeenCalled();
  });
});
