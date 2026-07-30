import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parseBuffer } = vi.hoisted(() => ({ parseBuffer: vi.fn() }));
vi.mock('music-metadata', () => ({ parseBuffer }));

import {
  AUDIO_TRANSCRIPTION_MAX_DURATION_SECONDS,
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  detectSupportedAudioSource,
  inspectSupportedAudioSource,
} from './audio-inspection';

const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);

describe('audio source inspection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseBuffer.mockResolvedValue({ format: { duration: 42 } });
  });

  it.each([
    [[0x49, 0x44, 0x33], 'audio/mpeg'],
    [[0xff, 0xfb, 0x90, 0x64], 'audio/mpeg'],
    [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 'audio/wav'],
    [[0x4f, 0x67, 0x67, 0x53], 'audio/ogg'],
    [[0x66, 0x4c, 0x61, 0x43], 'audio/flac'],
    [[0x1a, 0x45, 0xdf, 0xa3], 'audio/webm'],
    /* `ftyp` 必须带音频主 brand（`M4A `）才被认领；裸 ftyp 与视频 brand
       都属于其他容器，见 video-inspection.ts。 */
    [
      [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20],
      'audio/x-m4a',
    ],
  ] as const)('detects %s as %s from magic bytes', (bytes, mimeType) => {
    expect(detectSupportedAudioSource(new Uint8Array(bytes))).toMatchObject({
      mimeType,
    });
  });

  it('不认领缺少音频 brand 的 ISO-BMFF 容器', () => {
    /* 裸 ftyp 曾被当作 M4A，会让 MP4 视频误入音频转录路径。 */
    expect(
      detectSupportedAudioSource(
        new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]),
      ),
    ).toBeNull();
  });

  it('does not accept a renamed arbitrary file', () => {
    expect(
      detectSupportedAudioSource(new TextEncoder().encode('not audio')),
    ).toBeNull();
  });

  it('returns bounded duration without exposing parser metadata', async () => {
    await expect(inspectSupportedAudioSource(mp3)).resolves.toEqual({
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      durationSeconds: 42,
    });
    expect(parseBuffer).toHaveBeenCalledWith(
      mp3,
      { mimeType: 'audio/mpeg', size: mp3.byteLength },
      { duration: true, skipCovers: true },
    );
  });

  it('rejects missing, excessive duration and excessive bytes', async () => {
    parseBuffer.mockResolvedValueOnce({ format: {} });
    await expect(inspectSupportedAudioSource(mp3)).rejects.toMatchObject({
      code: 'audio_metadata_unavailable',
    });

    parseBuffer.mockResolvedValueOnce({
      format: {
        duration: AUDIO_TRANSCRIPTION_MAX_DURATION_SECONDS + 0.001,
      },
    });
    await expect(inspectSupportedAudioSource(mp3)).rejects.toMatchObject({
      code: 'audio_duration_exceeded',
    });

    await expect(
      inspectSupportedAudioSource(
        new Uint8Array(AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES + 1),
      ),
    ).rejects.toMatchObject({ code: 'audio_input_too_large' });
  });
});
