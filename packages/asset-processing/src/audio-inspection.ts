import { parseBuffer } from 'music-metadata';

export const AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const AUDIO_TRANSCRIPTION_MAX_DURATION_SECONDS = 60 * 60;

export const supportedAudioSourceMimeTypes = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
] as const;

export type SupportedAudioSourceMimeType =
  (typeof supportedAudioSourceMimeTypes)[number];

export type DetectedAudioSource = {
  mimeType: SupportedAudioSourceMimeType;
  extension: 'mp3' | 'wav' | 'ogg' | 'flac' | 'webm' | 'm4a';
};

export const audioInspectionFailureCodes = [
  'unsupported_audio_type',
  'audio_input_too_large',
  'audio_metadata_unavailable',
  'audio_duration_exceeded',
] as const;

export type AudioInspectionFailureCode =
  (typeof audioInspectionFailureCodes)[number];

export class AudioInspectionError extends Error {
  override readonly name = 'AudioInspectionError';

  constructor(
    readonly code: AudioInspectionFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

const bytesEqual = (
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean =>
  bytes.length >= offset + expected.length &&
  expected.every((value, index) => bytes[offset + index] === value);

const looksLikeMpegAudioFrame = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4 || bytes[0] !== 0xff || (bytes[1]! & 0xe0) !== 0xe0) {
    return false;
  }
  const versionBits = (bytes[1]! >> 3) & 0x03;
  const layerBits = (bytes[1]! >> 1) & 0x03;
  const bitrateIndex = (bytes[2]! >> 4) & 0x0f;
  const sampleRateIndex = (bytes[2]! >> 2) & 0x03;
  return (
    versionBits !== 0x01 &&
    layerBits !== 0 &&
    bitrateIndex !== 0 &&
    bitrateIndex !== 0x0f &&
    sampleRateIndex !== 0x03
  );
};

/**
 * 仅按容器魔术字识别首批音频格式。文件名、浏览器 MIME 和客户端声明都不参与判断。
 */
export function detectSupportedAudioSource(
  bytes: Uint8Array,
): DetectedAudioSource | null {
  if (
    bytesEqual(bytes, 0, [0x49, 0x44, 0x33]) ||
    looksLikeMpegAudioFrame(bytes)
  ) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  if (
    bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesEqual(bytes, 8, [0x57, 0x41, 0x56, 0x45])
  ) {
    return { mimeType: 'audio/wav', extension: 'wav' };
  }
  if (bytesEqual(bytes, 0, [0x4f, 0x67, 0x67, 0x53])) {
    return { mimeType: 'audio/ogg', extension: 'ogg' };
  }
  if (bytesEqual(bytes, 0, [0x66, 0x4c, 0x61, 0x43])) {
    return { mimeType: 'audio/flac', extension: 'flac' };
  }
  if (bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { mimeType: 'audio/webm', extension: 'webm' };
  }
  if (bytesEqual(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    return { mimeType: 'audio/x-m4a', extension: 'm4a' };
  }
  return null;
}

/**
 * 在调用转录 Provider 前解析完整音频元数据并实施时长预算。
 * `music-metadata`只返回结构化格式信息；标签、封面和原始解析错误均不向上层传播。
 */
export async function inspectSupportedAudioSource(
  bytes: Uint8Array,
): Promise<DetectedAudioSource & { durationSeconds: number }> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES
  ) {
    throw new AudioInspectionError('audio_input_too_large');
  }
  const detected = detectSupportedAudioSource(bytes);
  if (!detected) {
    throw new AudioInspectionError('unsupported_audio_type');
  }
  try {
    const metadata = await parseBuffer(
      bytes,
      { mimeType: detected.mimeType, size: bytes.byteLength },
      { duration: true, skipCovers: true },
    );
    const durationSeconds = metadata.format.duration;
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new AudioInspectionError('audio_metadata_unavailable');
    }
    if (durationSeconds > AUDIO_TRANSCRIPTION_MAX_DURATION_SECONDS) {
      throw new AudioInspectionError('audio_duration_exceeded');
    }
    return { ...detected, durationSeconds };
  } catch (error) {
    if (error instanceof AudioInspectionError) throw error;
    throw new AudioInspectionError('audio_metadata_unavailable', {
      cause: error,
    });
  }
}
