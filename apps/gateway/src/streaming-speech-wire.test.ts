import { describe, expect, it } from 'vitest';
import {
  decodeStreamingSpeechClientMessage,
  encodeStreamingSpeechAudioFrame,
} from './streaming-speech-wire';

describe('streaming speech wire', () => {
  it('只接受严格、连续性可由 channel 验证的命令形状', () => {
    expect(
      decodeStreamingSpeechClientMessage(
        JSON.stringify({ type: 'speech.submit', sequence: 1, text: '你好。' }),
      ),
    ).toEqual({ type: 'speech.submit', sequence: 1, text: '你好。' });
    expect(
      decodeStreamingSpeechClientMessage(
        JSON.stringify({
          type: 'speech.submit',
          sequence: 1,
          text: '你好。',
          userId: 'forbidden',
        }),
      ),
    ).toBeNull();
    expect(decodeStreamingSpeechClientMessage('{bad-json')).toBeNull();
  });

  it('用固定 header 编码偶数字节 PCM 并拒绝非法帧', () => {
    expect(encodeStreamingSpeechAudioFrame(0, Uint8Array.from([1, 2]))).toEqual(
      Uint8Array.from([0x45, 0x44, 0x54, 0x53, 0, 0, 0, 0, 1, 2]),
    );
    expect(encodeStreamingSpeechAudioFrame(0, Uint8Array.from([1]))).toBeNull();
    expect(
      encodeStreamingSpeechAudioFrame(-1, Uint8Array.from([1, 2])),
    ).toBeNull();
  });
});
