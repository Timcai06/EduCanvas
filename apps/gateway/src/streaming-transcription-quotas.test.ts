/**
 * V13 配额配置测试 — 默认值、环境变量覆盖与 fail-closed（非法配置启动失败）。
 */

import { describe, expect, it } from 'vitest';
import {
  STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
  readStreamingTranscriptionQuotas,
} from './streaming-transcription-quotas';

describe('StreamingTranscriptionQuotas（V13 配置）', () => {
  it('默认值：以课堂短时语音 + 单机 Gateway 为基线的保守上限', () => {
    expect(readStreamingTranscriptionQuotas({})).toEqual(
      STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
    );
    expect(STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS).toMatchObject({
      maxConnectionsPerUser: 2,
      maxConnectionsPerNotebook: 2,
      maxConnectionsGlobal: 32,
      maxActiveSessionsGlobal: 8,
      maxSessionDurationMs: 600_000,
      maxSessionIdleMs: 60_000,
      maxPcmBytesPerConnection: 1_920_000,
      maxChunksPerConnection: 4_096,
      maxQueuedInputMessages: 64,
      maxOutputBufferedBytes: 256 * 1024,
    });
  });

  it('环境变量覆盖合法值', () => {
    const quotas = readStreamingTranscriptionQuotas({
      EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER: '4',
      EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_GLOBAL: '16',
      EDUCANVAS_GATEWAY_STREAMING_MAX_ACTIVE_SESSIONS_GLOBAL: '4',
      EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_DURATION_MS: '120000',
      EDUCANVAS_GATEWAY_STREAMING_MAX_PCM_BYTES_PER_CONNECTION: '3200000',
    });
    expect(quotas.maxConnectionsPerUser).toBe(4);
    expect(quotas.maxConnectionsGlobal).toBe(16);
    expect(quotas.maxActiveSessionsGlobal).toBe(4);
    expect(quotas.maxSessionDurationMs).toBe(120_000);
    expect(quotas.maxPcmBytesPerConnection).toBe(3_200_000);
    // 未设置项保持默认。
    expect(quotas.maxChunksPerConnection).toBe(4_096);
  });

  it('非法配置 fail closed：非整数/越界/空白一律抛错', () => {
    const cases: Array<[string, string]> = [
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', '0'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', '65'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', 'abc'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', '1.5'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', '0x10'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', '1e2'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER', '2.0'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_GLOBAL', '0'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_ACTIVE_SESSIONS_GLOBAL', '0'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_DURATION_MS', '999'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_DURATION_MS', '3600001'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_IDLE_MS', '0'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_PCM_BYTES_PER_CONNECTION', '31999'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_CHUNKS_PER_CONNECTION', '-1'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_QUEUED_INPUT_MESSAGES', '0'],
      ['EDUCANVAS_GATEWAY_STREAMING_MAX_OUTPUT_BUFFERED_BYTES', '0'],
    ];
    for (const [name, value] of cases) {
      expect(
        () => readStreamingTranscriptionQuotas({ [name]: value }),
        `${name}=${value} 应 fail closed`,
      ).toThrow();
    }
  });

  it('idle 不小于 duration 时 fail closed（deadline 顺序必须确定）', () => {
    expect(() =>
      readStreamingTranscriptionQuotas({
        EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_IDLE_MS: '60000',
        EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_DURATION_MS: '60000',
      }),
    ).toThrow(/SESSION_IDLE_MS/);
    expect(() =>
      readStreamingTranscriptionQuotas({
        EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_IDLE_MS: '120000',
        EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_DURATION_MS: '60000',
      }),
    ).toThrow(/SESSION_IDLE_MS/);
  });

  it('空字符串视为未设置（用默认值）', () => {
    const quotas = readStreamingTranscriptionQuotas({
      EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER: '  ',
    });
    expect(quotas.maxConnectionsPerUser).toBe(2);
  });
});
