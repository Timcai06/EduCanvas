import { describe, expect, it } from 'vitest';
import { detectSupportedAudioSource } from './audio-inspection';
import {
  VIDEO_SOURCE_MAX_DURATION_SECONDS,
  VIDEO_SOURCE_MAX_INPUT_BYTES,
  VIDEO_SOURCE_MAX_PIXELS,
  VideoInspectionError,
  assertVideoProcessingBudget,
  assertVideoUploadBudget,
  detectSupportedVideoSource,
  readIsoBaseMediaBrand,
} from './video-inspection';

/** 构造 ISO-BMFF 头：4 字节 box size + `ftyp` + 4 字节主 brand。 */
function isoContainer(brand: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  bytes.set(
    [...brand].map((character) => character.charCodeAt(0)),
    8,
  );
  return bytes;
}

describe('detectSupportedVideoSource', () => {
  it.each([
    ['isom', 'video/mp4', 'mp4'],
    ['mp42', 'video/mp4', 'mp4'],
    ['avc1', 'video/mp4', 'mp4'],
    ['qt  ', 'video/quicktime', 'mov'],
  ])('按 brand %s 识别为 %s', (brand, mimeType, extension) => {
    expect(detectSupportedVideoSource(isoContainer(brand))).toEqual({
      mimeType,
      extension,
    });
  });

  it('音频 brand 不被认领为视频', () => {
    for (const brand of ['M4A ', 'M4B ']) {
      expect(detectSupportedVideoSource(isoContainer(brand))).toBeNull();
    }
  });

  it('未知 brand 与非 ISO-BMFF 字节一律不认领', () => {
    expect(detectSupportedVideoSource(isoContainer('xxxx'))).toBeNull();
    expect(
      detectSupportedVideoSource(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])),
    ).toBeNull();
    expect(detectSupportedVideoSource(new Uint8Array(3))).toBeNull();
  });

  it('WebM 不在首批白名单：容器头无法区分有无视轨', () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    expect(detectSupportedVideoSource(webm)).toBeNull();
    /* 同一段字节仍然由音频路径认领，既有行为不变。 */
    expect(detectSupportedAudioSource(webm)).toEqual({
      mimeType: 'audio/webm',
      extension: 'webm',
    });
  });
});

describe('音频与视频的 ftyp 边界', () => {
  it('视频 brand 不再被音频探测认领为 M4A', () => {
    /* 早期实现把所有 ftyp 都当 M4A，一段 MP4 会被送进音频转录路径。 */
    for (const brand of ['isom', 'mp42', 'qt  ']) {
      expect(detectSupportedAudioSource(isoContainer(brand))).toBeNull();
    }
  });

  it('音频 brand 仍被音频探测正确认领', () => {
    expect(detectSupportedAudioSource(isoContainer('M4A '))).toEqual({
      mimeType: 'audio/x-m4a',
      extension: 'm4a',
    });
  });

  it('readIsoBaseMediaBrand 对非 ISO-BMFF 返回 null', () => {
    expect(
      readIsoBaseMediaBrand(new Uint8Array([0x49, 0x44, 0x33])),
    ).toBeNull();
    expect(readIsoBaseMediaBrand(isoContainer('isom'))).toBe('isom');
  });
});

describe('视频预算', () => {
  it('字节上限在上传阶段生效', () => {
    expect(() => assertVideoUploadBudget(1_024)).not.toThrow();
    expect(() => assertVideoUploadBudget(0)).toThrow(VideoInspectionError);
    expect(() =>
      assertVideoUploadBudget(VIDEO_SOURCE_MAX_INPUT_BYTES + 1),
    ).toThrowError(expect.objectContaining({ code: 'video_input_too_large' }));
  });

  it('时长与分辨率上限在探测阶段生效', () => {
    expect(() =>
      assertVideoProcessingBudget({
        durationSeconds: 60,
        width: 1280,
        height: 720,
      }),
    ).not.toThrow();

    expect(() =>
      assertVideoProcessingBudget({
        durationSeconds: VIDEO_SOURCE_MAX_DURATION_SECONDS + 1,
        width: 1280,
        height: 720,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'video_duration_exceeded' }),
    );

    expect(() =>
      assertVideoProcessingBudget({
        durationSeconds: 60,
        width: 4096,
        height: 2160,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'video_resolution_exceeded' }),
    );
  });

  it('分辨率按像素总数限制，极端长条不能绕过', () => {
    expect(() =>
      assertVideoProcessingBudget({
        durationSeconds: 60,
        width: VIDEO_SOURCE_MAX_PIXELS,
        height: 2,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'video_resolution_exceeded' }),
    );
  });

  it('缺失或非法元数据收敛为 metadata_unavailable', () => {
    for (const metadata of [
      { durationSeconds: Number.NaN, width: 640, height: 480 },
      { durationSeconds: 0, width: 640, height: 480 },
      { durationSeconds: 10, width: 0, height: 480 },
      { durationSeconds: 10, width: 640.5, height: 480 },
    ]) {
      expect(() => assertVideoProcessingBudget(metadata)).toThrowError(
        expect.objectContaining({ code: 'video_metadata_unavailable' }),
      );
    }
  });
});
