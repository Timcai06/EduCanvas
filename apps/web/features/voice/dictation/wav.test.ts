import { describe, expect, it } from 'vitest';
import { encodePcm16LeWav } from './wav';

describe('encodePcm16LeWav', () => {
  it('封装 16 kHz mono PCM16LE 且按顺序拼接 chunk', () => {
    const wav = encodePcm16LeWav([
      Uint8Array.from([1, 2]),
      Uint8Array.from([3, 4, 5, 6]),
    ]);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
