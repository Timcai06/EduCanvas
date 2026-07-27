/**
 * 视频来源识别与预算（ADR-0016）。
 *
 * 首批只收 MP4 与 QuickTime 两种 `ftyp` 容器，**刻意不收 WebM**：WebM 与
 * 音频 WebM 共用同一个 EBML 魔术字，仅凭容器头无法区分「有视轨」和「纯音频」，
 * 而现有音频路径已经在用同一个魔术字。在没有完整解析的前提下加入 WebM，
 * 只会让两条路径互相误收。
 */

export const VIDEO_SOURCE_MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const VIDEO_SOURCE_MAX_DURATION_SECONDS = 20 * 60;
/** 分辨率上限按像素总数而不是宽高分别限制，避免 1×N 的极端长条绕过限制。 */
export const VIDEO_SOURCE_MAX_PIXELS = 1920 * 1080;

export const supportedVideoSourceMimeTypes = [
  'video/mp4',
  'video/quicktime',
] as const;

export type SupportedVideoSourceMimeType =
  (typeof supportedVideoSourceMimeTypes)[number];

export type DetectedVideoSource = {
  mimeType: SupportedVideoSourceMimeType;
  extension: 'mp4' | 'mov';
};

export const videoInspectionFailureCodes = [
  'unsupported_video_type',
  'video_input_too_large',
  'video_metadata_unavailable',
  'video_duration_exceeded',
  'video_resolution_exceeded',
  'video_audio_track_missing',
] as const;

export type VideoInspectionFailureCode =
  (typeof videoInspectionFailureCodes)[number];

export class VideoInspectionError extends Error {
  override readonly name = 'VideoInspectionError';

  constructor(
    readonly code: VideoInspectionFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

const FTYP_OFFSET = 4;

/**
 * ISO-BMFF 主 brand 白名单。
 *
 * `ftyp` 出现在 MP4、M4A、MOV 等多种容器里，只有 brand 能区分它们。音频
 * brand（`M4A `、`M4B `）必须留给音频路径，否则一段音频会被当成视频送进
 * 转码流水线，反之亦然。
 */
const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'dash',
  'mmp4',
]);

const QUICKTIME_BRAND = 'qt  ';

/** ISO-BMFF 音频 brand；供音频侧共用，避免两处各写一份清单而漂移。 */
export const ISO_AUDIO_BRANDS: ReadonlySet<string> = new Set([
  'M4A ',
  'M4B ',
  'M4P ',
]);

/** 读取 `ftyp` 主 brand；不是 ISO-BMFF 容器时返回 null。 */
export function readIsoBaseMediaBrand(bytes: Uint8Array): string | null {
  if (
    bytes.length < FTYP_OFFSET + 8 ||
    bytes[FTYP_OFFSET] !== 0x66 ||
    bytes[FTYP_OFFSET + 1] !== 0x74 ||
    bytes[FTYP_OFFSET + 2] !== 0x79 ||
    bytes[FTYP_OFFSET + 3] !== 0x70
  ) {
    return null;
  }
  return String.fromCharCode(...bytes.slice(FTYP_OFFSET + 4, FTYP_OFFSET + 8));
}

/**
 * 仅按容器 brand 识别首批视频格式。文件名、浏览器 MIME 和客户端声明都不参与判断。
 */
export function detectSupportedVideoSource(
  bytes: Uint8Array,
): DetectedVideoSource | null {
  const brand = readIsoBaseMediaBrand(bytes);
  if (brand === null) return null;
  if (brand === QUICKTIME_BRAND) {
    return { mimeType: 'video/quicktime', extension: 'mov' };
  }
  if (VIDEO_BRANDS.has(brand)) {
    return { mimeType: 'video/mp4', extension: 'mp4' };
  }
  return null;
}

/** 上传侧的字节预算。时长与分辨率必须等到 Worker 里用 ffprobe 才能判定。 */
export function assertVideoUploadBudget(byteLength: number): void {
  if (byteLength <= 0 || byteLength > VIDEO_SOURCE_MAX_INPUT_BYTES) {
    throw new VideoInspectionError('video_input_too_large');
  }
}

/** 已探测出的视频元数据是否满足平台策略；不满足即抛稳定失败码。 */
export function assertVideoProcessingBudget(metadata: {
  durationSeconds: number;
  width: number;
  height: number;
}): void {
  if (
    !Number.isFinite(metadata.durationSeconds) ||
    metadata.durationSeconds <= 0
  ) {
    throw new VideoInspectionError('video_metadata_unavailable');
  }
  if (metadata.durationSeconds > VIDEO_SOURCE_MAX_DURATION_SECONDS) {
    throw new VideoInspectionError('video_duration_exceeded');
  }
  if (
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new VideoInspectionError('video_metadata_unavailable');
  }
  if (metadata.width * metadata.height > VIDEO_SOURCE_MAX_PIXELS) {
    throw new VideoInspectionError('video_resolution_exceeded');
  }
}
