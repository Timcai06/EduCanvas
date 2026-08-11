import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveVoiceCapability } from './voice-capability';

const healthyEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  EDUCANVAS_GATEWAY_URL: 'http://127.0.0.1:3200',
  EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: 'b'.repeat(32),
  DASHSCOPE_API_KEY: 'd'.repeat(32),
  DASHSCOPE_WORKSPACE_ID: 'workspace-test',
};

describe('resolveVoiceCapability', () => {
  it('模型与连接全部健康才返回公开 WS URL', async () => {
    const result = await resolveVoiceCapability({
      env: healthyEnv,
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: true,
        }),
      ) as typeof fetch,
    });
    expect(result.checks.every((check) => check.healthy)).toBe(true);
    expect(result.websocketUrl).toBe(
      'ws://127.0.0.1:3200/v1/client/streaming-transcription',
    );
  });

  it('Bootstrap transport 未配置时 fail closed 且不返回 WS URL', async () => {
    const result = await resolveVoiceCapability({
      env: { ...healthyEnv, EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: '' },
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: true,
        }),
      ) as typeof fetch,
    });
    expect(result.checks).toContainEqual({
      key: 'connection',
      healthy: false,
    });
    expect(result.websocketUrl).toBeNull();
  });

  it('TTS 不可用时仍保留实时 ASR URL，供能力层独立判定', async () => {
    const result = await resolveVoiceCapability({
      env: { ...healthyEnv, DASHSCOPE_API_KEY: '' },
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: true,
        }),
      ) as typeof fetch,
    });
    expect(result.checks).toContainEqual({ key: 'speech', healthy: false });
    expect(result.websocketUrl).toBe(
      'ws://127.0.0.1:3200/v1/client/streaming-transcription',
    );
  });

  it('Gateway 未解析出真实适配器时模型闸门保持关闭', async () => {
    const result = await resolveVoiceCapability({
      env: healthyEnv,
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: false,
        }),
      ) as typeof fetch,
    });
    expect(result.checks).toContainEqual({ key: 'model', healthy: false });
    expect(result.websocketUrl).toBeNull();
  });

  it('Gateway 异常时只返回关闭状态', async () => {
    const result = await resolveVoiceCapability({
      env: healthyEnv,
      fetchImpl: vi.fn(async () => {
        throw new Error('raw network detail');
      }) as typeof fetch,
    });
    expect(result.websocketUrl).toBeNull();
    expect(result.checks).toContainEqual({
      key: 'connection',
      healthy: false,
    });
    expect(result.checks).toContainEqual({ key: 'model', healthy: false });
  });
});
