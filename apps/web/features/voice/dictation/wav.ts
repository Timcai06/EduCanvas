import { STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ } from '@educanvas/agent-core';

const HEADER_BYTES = 44;

/** 将采集器产出的 16 kHz mono PCM16LE 封装为标准 PCM WAV，仅在内存中存在。 */
export function encodePcm16LeWav(chunks: readonly Uint8Array[]): Uint8Array {
  const dataBytes = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const wav = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      wav[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ, true);
  view.setUint32(28, STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = HEADER_BYTES;
  for (const chunk of chunks) {
    wav.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return wav;
}
