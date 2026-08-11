import { describe, expect, it } from 'vitest';
import { parseVoiceCapabilityResponse } from './voice-capability-client';

describe('parseVoiceCapabilityResponse', () => {
  it('接受 Live Voice 的 model/speech/connection 三项能力响应', () => {
    const value = parseVoiceCapabilityResponse({
      checks: [
        { key: 'model', healthy: true },
        { key: 'connection', healthy: true },
        { key: 'speech', healthy: true },
      ],
      websocketUrl: 'ws://127.0.0.1:3200/v1/client/streaming-transcription',
    });
    expect(value.checks).toHaveLength(3);
  });

  it('旧的两项响应 fail closed', () => {
    expect(() =>
      parseVoiceCapabilityResponse({
        checks: [
          { key: 'model', healthy: true },
          { key: 'connection', healthy: true },
        ],
        websocketUrl: null,
      }),
    ).toThrow();
  });
});
