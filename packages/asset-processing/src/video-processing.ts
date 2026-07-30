import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  VideoInspectionError,
  assertVideoProcessingBudget,
} from './video-inspection';

const run = promisify(execFile);

/**
 * 关键帧抽取算法版本。抽帧策略（帧数、时间点选择、编码参数）任何一项变化都必须
 * 提升版本，否则历史帧与新帧无法区分是不同算法还是不同内容。
 */
export const VIDEO_KEYFRAME_ALGORITHM_VERSION =
  'even-interval-jpeg-v1' as const;

/** 首批固定抽取的关键帧数量。上界写死而不是按时长缩放，避免长视频放大存储。 */
export const VIDEO_KEYFRAME_COUNT = 4;

/** 单帧 JPEG 的字节上限；超出即认为抽帧参数失控。 */
const KEYFRAME_MAX_BYTES = 2 * 1024 * 1024;

/** 提取音轨的字节上限，与音频转录入口保持同一预算。 */
const AUDIO_TRACK_MAX_BYTES = 25 * 1024 * 1024;

/**
 * 外部工具的资源边界。
 *
 * - `timeoutMs`：硬超时，超时后 Node 发送 SIGKILL，避免损坏文件让进程挂死；
 * - `maxBuffer`：ffprobe 的 JSON 输出上界，防止畸形文件产出无界 stdout；
 * - `-nostdin`：ffmpeg 默认会读 stdin，在 Worker 里会挂住；
 * - `-threads 1`：单任务不抢占整个 Worker 的 CPU，并发度由队列控制。
 */
const PROBE_TIMEOUT_MS = 20_000;
const TRANSCODE_TIMEOUT_MS = 120_000;
const PROBE_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export const videoProcessingFailureCodes = [
  'video_toolchain_unavailable',
  'video_probe_failed',
  'video_audio_extraction_failed',
  'video_keyframe_extraction_failed',
] as const;

export type VideoProcessingFailureCode =
  (typeof videoProcessingFailureCodes)[number];

export class VideoProcessingError extends Error {
  override readonly name = 'VideoProcessingError';

  constructor(
    readonly code: VideoProcessingFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudioTrack: boolean;
}

export interface VideoKeyframe {
  ordinal: number;
  timestampSeconds: number;
  bytes: Uint8Array;
}

export interface VideoToolchain {
  ffmpegPath: string;
  ffprobePath: string;
}

/**
 * 从环境解析外部工具路径。
 *
 * 不打包 ffmpeg 二进制：它有平台差异与授权约束，把它留给部署方显式提供，
 * 缺失时以稳定失败码诚实失败，好过在仓库里塞一个几十 MB 的平台相关产物。
 */
export function resolveVideoToolchain(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): VideoToolchain {
  return {
    ffmpegPath: environment.EDUCANVAS_FFMPEG_PATH?.trim() || 'ffmpeg',
    ffprobePath: environment.EDUCANVAS_FFPROBE_PATH?.trim() || 'ffprobe',
  };
}

/** ENOENT 表示部署没装工具链，与「文件本身有问题」是完全不同的处置。 */
function isMissingBinary(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

/**
 * 探测视频元数据。
 *
 * 只用 `execFile` 并传入固定 argv 数组，绝不经过 shell：文件路径来自服务端临时
 * 目录，但 argv 形式让「路径里有什么字符」永远不可能变成命令。
 */
export async function probeVideoFile(
  filePath: string,
  toolchain: VideoToolchain = resolveVideoToolchain(),
): Promise<VideoMetadata> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      toolchain.ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
    ));
  } catch (error) {
    if (isMissingBinary(error)) {
      throw new VideoProcessingError('video_toolchain_unavailable', {
        cause: error,
      });
    }
    throw new VideoProcessingError('video_probe_failed', { cause: error });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new VideoProcessingError('video_probe_failed', { cause: error });
  }
  const streams = (payload as { streams?: unknown }).streams;
  const format = (payload as { format?: { duration?: unknown } }).format;
  if (!Array.isArray(streams)) {
    throw new VideoProcessingError('video_probe_failed');
  }

  const videoStream = streams.find(
    (stream) =>
      typeof stream === 'object' &&
      stream !== null &&
      (stream as { codec_type?: unknown }).codec_type === 'video',
  ) as { width?: unknown; height?: unknown } | undefined;
  if (!videoStream) {
    /* 没有视轨的 ISO-BMFF 文件属于音频路径，不该走到这里。 */
    throw new VideoInspectionError('unsupported_video_type');
  }

  const durationSeconds = Number(format?.duration);
  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  assertVideoProcessingBudget({ durationSeconds, width, height });

  return {
    durationSeconds,
    width,
    height,
    hasAudioTrack: streams.some(
      (stream) =>
        typeof stream === 'object' &&
        stream !== null &&
        (stream as { codec_type?: unknown }).codec_type === 'audio',
    ),
  };
}

/**
 * 提取单声道 16 kHz MP3 音轨。
 *
 * 降采样与单声道不是画质取舍而是成本控制：转录模型对语音只需要这个规格，
 * 保留原始码率只会让上传给 Provider 的字节数翻数倍。
 */
export async function extractVideoAudioTrack(
  input: { filePath: string; workingDirectory: string },
  toolchain: VideoToolchain = resolveVideoToolchain(),
): Promise<Uint8Array> {
  const outputPath = path.join(input.workingDirectory, 'audio.mp3');
  try {
    await run(
      toolchain.ffmpegPath,
      [
        '-nostdin',
        '-y',
        '-threads',
        '1',
        '-i',
        input.filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '64k',
        '-f',
        'mp3',
        outputPath,
      ],
      { timeout: TRANSCODE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
    );
  } catch (error) {
    if (isMissingBinary(error)) {
      throw new VideoProcessingError('video_toolchain_unavailable', {
        cause: error,
      });
    }
    throw new VideoProcessingError('video_audio_extraction_failed', {
      cause: error,
    });
  }

  const bytes = new Uint8Array(await readFile(outputPath));
  if (bytes.byteLength === 0 || bytes.byteLength > AUDIO_TRACK_MAX_BYTES) {
    throw new VideoProcessingError('video_audio_extraction_failed');
  }
  return bytes;
}

/**
 * 按等间隔抽取关键帧。
 *
 * 用 `fps` 滤镜而不是逐帧 seek：一次解码扫描产出全部帧，避免对同一文件做 N 次
 * seek + 解码。时间点由等间隔推导，因此同一输入永远得到同一组帧。
 */
export async function extractVideoKeyframes(
  input: {
    filePath: string;
    workingDirectory: string;
    durationSeconds: number;
    count?: number;
  },
  toolchain: VideoToolchain = resolveVideoToolchain(),
): Promise<readonly VideoKeyframe[]> {
  const count = Math.max(1, Math.min(input.count ?? VIDEO_KEYFRAME_COUNT, 16));
  const interval = input.durationSeconds / count;
  const framesDirectory = path.join(input.workingDirectory, 'frames');
  /* ffmpeg 的 image2 输出不会自建目录，缺目录会以难读的写入错误失败。 */
  await mkdir(framesDirectory, { recursive: true });

  try {
    await run(
      toolchain.ffmpegPath,
      [
        '-nostdin',
        '-y',
        '-threads',
        '1',
        '-i',
        input.filePath,
        '-vf',
        `fps=1/${interval.toFixed(6)},scale=640:-2`,
        '-frames:v',
        String(count),
        '-q:v',
        '5',
        '-f',
        'image2',
        path.join(framesDirectory, 'frame-%03d.jpg'),
      ],
      { timeout: TRANSCODE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
    );
  } catch (error) {
    if (isMissingBinary(error)) {
      throw new VideoProcessingError('video_toolchain_unavailable', {
        cause: error,
      });
    }
    throw new VideoProcessingError('video_keyframe_extraction_failed', {
      cause: error,
    });
  }

  const fileNames = (await readdir(framesDirectory)).sort();
  const frames: VideoKeyframe[] = [];
  for (const [index, fileName] of fileNames.entries()) {
    if (index >= count) break;
    const bytes = new Uint8Array(
      await readFile(path.join(framesDirectory, fileName)),
    );
    if (bytes.byteLength === 0 || bytes.byteLength > KEYFRAME_MAX_BYTES) {
      throw new VideoProcessingError('video_keyframe_extraction_failed');
    }
    frames.push({
      ordinal: index + 1,
      /* 第 n 帧对应区间中点，比区间起点更能代表这一段内容。 */
      timestampSeconds: Number((interval * (index + 0.5)).toFixed(3)),
      bytes,
    });
  }
  if (frames.length === 0) {
    throw new VideoProcessingError('video_keyframe_extraction_failed');
  }
  return frames;
}

/**
 * 在受控临时目录中执行视频派生，无论成功失败都回收目录。
 *
 * 临时文件残留是这条流水线最容易出的运维问题：转码中途被 SIGKILL 时不会有任何
 * 代码继续执行，因此清理必须挂在 `finally` 上，而不是成功分支里。
 */
export async function withVideoWorkspace<Result>(
  bytes: Uint8Array,
  extension: string,
  operation: (input: {
    filePath: string;
    workingDirectory: string;
  }) => Promise<Result>,
): Promise<Result> {
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'educanvas-video-'),
  );
  try {
    const filePath = path.join(workingDirectory, `source.${extension}`);
    await writeFile(filePath, bytes);
    return await operation({ filePath, workingDirectory });
  } finally {
    await rm(workingDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}
