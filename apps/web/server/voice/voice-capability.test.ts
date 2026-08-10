import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveVoiceCapability } from './voice-capability';

const healthyEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  EDUCANVAS_GATEWAY_URL: 'http://127.0.0.1:3200',
  EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN: 'b'.repeat(32),
  EDUCANVAS_AUDIO_DELETION_WORKER_ENABLED: 'true',
};

describe('resolveVoiceCapability', () => {
  it('五维全部健康才返回公开 WS URL', async () => {
    const result = await resolveVoiceCapability('user:1', {
      env: healthyEnv,
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: true,
        }),
      ) as typeof fetch,
      repository: {
        checkVoiceProcessingReadiness: vi.fn(async () => ({
          consentActive: true,
          repositoryHealthy: true as const,
        })),
      },
    });
    expect(result.checks.every((check) => check.healthy)).toBe(true);
    expect(result.websocketUrl).toBe(
      'ws://127.0.0.1:3200/v1/client/streaming-transcription',
    );
  });

  it('同意撤回或删除 Worker 未部署时 fail closed 且不返回 WS URL', async () => {
    const result = await resolveVoiceCapability('user:1', {
      env: {
        ...healthyEnv,
        EDUCANVAS_AUDIO_DELETION_WORKER_ENABLED: 'false',
      },
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: true,
        }),
      ) as typeof fetch,
      repository: {
        checkVoiceProcessingReadiness: vi.fn(async () => ({
          consentActive: false,
          repositoryHealthy: true as const,
        })),
      },
    });
    expect(result.checks).toContainEqual({ key: 'consent', healthy: false });
    expect(result.checks).toContainEqual({
      key: 'deletion-worker',
      healthy: false,
    });
    expect(result.websocketUrl).toBeNull();
  });

  it('Gateway 未解析出真实适配器时模型闸门保持关闭', async () => {
    const result = await resolveVoiceCapability('user:1', {
      env: healthyEnv,
      fetchImpl: vi.fn(async () =>
        Response.json({
          service: 'educanvas-gateway',
          status: 'ok',
          protocol: 'gateway.v1',
          streamingTranscriptionEnabled: false,
        }),
      ) as typeof fetch,
      repository: {
        checkVoiceProcessingReadiness: vi.fn(async () => ({
          consentActive: true,
          repositoryHealthy: true as const,
        })),
      },
    });
    expect(result.checks).toContainEqual({ key: 'model', healthy: false });
    expect(result.websocketUrl).toBeNull();
  });

  it('Gateway 或 Repository 异常时只返回关闭状态', async () => {
    const result = await resolveVoiceCapability('user:1', {
      env: healthyEnv,
      fetchImpl: vi.fn(async () => {
        throw new Error('raw network detail');
      }) as typeof fetch,
      repository: {
        checkVoiceProcessingReadiness: vi.fn(async () => {
          throw new Error('raw db detail');
        }),
      },
    });
    expect(result.websocketUrl).toBeNull();
    expect(result.checks).toContainEqual({
      key: 'connection',
      healthy: false,
    });
    expect(result.checks).toContainEqual({ key: 'retention', healthy: false });
  });
});
