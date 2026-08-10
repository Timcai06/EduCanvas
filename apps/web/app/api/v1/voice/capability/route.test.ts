import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  readMode: vi.fn(),
  resolveCapability: vi.fn(),
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

import { GET } from './route';

describe('GET /api/v1/voice/capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readIdentity.mockResolvedValue({ studentId: 'user:1' });
    mocks.readMode.mockResolvedValue('restricted');
    mocks.resolveCapability.mockResolvedValue({
      checks: [
        { key: 'model', healthy: true },
        { key: 'connection', healthy: true },
      ],
      websocketUrl: 'ws://localhost:3200/v1/client/streaming-transcription',
    });
  });

  it('限制模式允许查询瞬时语音基础设施能力', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checks: [
        { key: 'model', healthy: true },
        { key: 'connection', healthy: true },
      ],
    });
    expect(mocks.resolveCapability).toHaveBeenCalledWith();
  });

  it('未选择模式时返回关闭状态且不探测 Gateway', async () => {
    mocks.readMode.mockResolvedValue(null);
    const response = await GET();
    expect(await response.json()).toEqual({
      checks: [
        { key: 'model', healthy: false },
        { key: 'connection', healthy: false },
      ],
      websocketUrl: null,
    });
    expect(mocks.resolveCapability).not.toHaveBeenCalled();
  });
});
