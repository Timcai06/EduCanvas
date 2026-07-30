import { createHash } from 'node:crypto';
import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import {
  VideoInspectionError,
  VideoProcessingError,
  VIDEO_KEYFRAME_ALGORITHM_VERSION,
  detectSupportedVideoSource,
  extractVideoAudioTrack,
  extractVideoKeyframes,
  probeVideoFile,
  withVideoWorkspace,
  type VideoKeyframe,
} from '@educanvas/asset-processing';
import {
  DrizzleAssetVideoRepository,
  type VideoKeyframeRecord,
  type VideoProcessingOutcome,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { getAssetTaskStorage } from './asset-task-storage.js';

const payloadSchema = z.object({ jobId: z.string().uuid() }).strict();

/** 提取出的音轨固定为单声道 MP3，与音频转录 Port 的白名单一致。 */
const AUDIO_TRACK_MIME = 'audio/mpeg' as const;

/**
 * 视频来源处理任务（ADR-0016）。
 *
 * 三个阶段的失败语义各不相同：
 * 1. **探测**（格式、时长、分辨率）失败是整体失败——没有元数据就没有可用版本；
 * 2. **音轨转录**失败只影响转录 representation，可能只是这段视频没有音轨；
 * 3. **关键帧抽取**失败只影响关键帧 representation。
 *
 * 因此 2、3 任一失败都不会拖垮整个版本：版本仍进入 ready，两路各自留下自己的
 * ready/failed/unavailable，UI 与重试因此能分别处理。
 *
 * ffmpeg/ffprobe 只在 Worker 进程中以固定 argv 数组 spawn，不经过 shell，
 * 带硬超时，临时目录无论成败都在 `finally` 中回收。
 */
export const processVideoTask: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const videos = new DrizzleAssetVideoRepository();

  const pending = await videos.beginAttempt({ jobId: payload.jobId });
  /* 任务已终结（重复投递或版本已被处置）：安静退出，不当作错误。 */
  if (!pending) return;

  try {
    const storage = await getAssetTaskStorage();
    const bytes = await storage.readVerified(
      pending.storageKey,
      pending.contentHash,
    );
    if (bytes.byteLength !== pending.byteSize) {
      throw new VideoInspectionError('video_metadata_unavailable');
    }
    /* 容器 brand 在 Worker 侧重新判定：上传时的判断不作为处理阶段的依据。 */
    const detected = detectSupportedVideoSource(bytes);
    if (!detected || detected.mimeType !== pending.mimeType) {
      throw new VideoInspectionError('unsupported_video_type');
    }

    const outcome = await withVideoWorkspace(
      bytes,
      detected.extension,
      async (workspace) => {
        const metadata = await probeVideoFile(workspace.filePath);
        return {
          durationSeconds: metadata.durationSeconds,
          width: metadata.width,
          height: metadata.height,
          transcription: await transcribeAudioTrack({
            workspace,
            hasAudioTrack: metadata.hasAudioTrack,
            jobId: payload.jobId,
            durationSeconds: metadata.durationSeconds,
          }),
          keyframes: await deriveKeyframes({
            workspace,
            assetVersionId: pending.assetVersionId,
            durationSeconds: metadata.durationSeconds,
            storage,
          }),
        } satisfies VideoProcessingOutcome;
      },
    );

    await videos.settleProcessed({ jobId: payload.jobId, outcome });
    helpers.logger.info(
      `视频来源 ${pending.assetVersionId} 处理完成，转录=${outcome.transcription.status}，关键帧=${outcome.keyframes.status}`,
    );
  } catch (error) {
    const terminal = terminalFailureCode(error);
    if (terminal) {
      await videos.settleFailed({
        jobId: payload.jobId,
        failureCode: terminal,
      });
      return;
    }
    /*
     * Graphile 在领取任务时已把 attempts 加一。最后一次仍失败时不能只让队列
     * 永久失败而把业务账本留在 running；只落稳定失败码，不保存原始异常与路径。
     */
    if (helpers.job.attempts >= helpers.job.max_attempts) {
      await videos.settleFailed({
        jobId: payload.jobId,
        failureCode: 'asset_processing_exhausted',
      });
      return;
    }
    throw error;
  }
};

/** 探测阶段的确定性失败；重试不会改变结果。 */
function terminalFailureCode(error: unknown): string | null {
  if (error instanceof VideoInspectionError) return error.code;
  if (
    error instanceof VideoProcessingError &&
    (error.code === 'video_probe_failed' ||
      error.code === 'video_toolchain_unavailable')
  ) {
    return error.code;
  }
  return null;
}

/**
 * 提取音轨并复用既有音频转录 Port。
 *
 * 不新增第二套转录体系：这里只负责把视频变成一段符合白名单的音频字节，之后完全
 * 走 `AudioTranscriptionModelGateway`。没有音轨返回 `unavailable` 而不是失败——
 * 无声视频是合法输入，不是错误。
 */
async function transcribeAudioTrack(input: {
  workspace: { filePath: string; workingDirectory: string };
  hasAudioTrack: boolean;
  jobId: string;
  durationSeconds: number;
}): Promise<VideoProcessingOutcome['transcription']> {
  if (!input.hasAudioTrack) return { status: 'unavailable' };

  try {
    const audioBytes = await extractVideoAudioTrack(input.workspace);
    // 动态导入避免无 Provider 配置时的 Worker 启动报错。
    const { resolveAudioTranscriptionModelGateway } =
      await import('../model-runtime.js');
    const gateway = resolveAudioTranscriptionModelGateway();
    if (!gateway) {
      return {
        status: 'failed',
        failureCode: 'video_transcription_not_configured',
      };
    }
    const result = await gateway.transcribeAudio({
      taskAlias: 'audio.transcribe',
      modelAlias: 'transcription',
      audioBytes,
      mimeType: AUDIO_TRACK_MIME,
      promptVersion: 'video-audio-transcription-v1',
      traceId: `asset-video:${input.jobId}`,
      operationId: input.jobId,
    });
    if (!result.text.trim()) {
      return { status: 'failed', failureCode: 'video_transcription_empty' };
    }
    return {
      status: 'ready',
      text: result.text,
      metadata: {
        provider: result.metadata.provider,
        resolvedModelId: result.metadata.resolvedModelId,
        latencyMs: result.metadata.latencyMs,
        traceId: result.metadata.traceId,
        language: result.language,
        /* 本地容器解析是时长权威，不采信 Provider 回包。 */
        durationSeconds: input.durationSeconds,
      },
    };
  } catch (error) {
    if (error instanceof VideoProcessingError) {
      return { status: 'failed', failureCode: error.code };
    }
    if (error instanceof ModelGatewayInvocationError) {
      return {
        status: 'failed',
        failureCode: `video_transcription_${error.normalized.code}`,
      };
    }
    return { status: 'failed', failureCode: 'video_transcription_failed' };
  }
}

/**
 * 抽帧并写入受控对象存储。
 *
 * 对象键由内容哈希派生：同一版本重投产生完全相同的键与内容，重复写入是幂等
 * 覆盖而不是产生孤儿对象。
 */
async function deriveKeyframes(input: {
  workspace: { filePath: string; workingDirectory: string };
  assetVersionId: string;
  durationSeconds: number;
  storage: Awaited<ReturnType<typeof getAssetTaskStorage>>;
}): Promise<VideoProcessingOutcome['keyframes']> {
  let frames: readonly VideoKeyframe[];
  try {
    frames = await extractVideoKeyframes({
      ...input.workspace,
      durationSeconds: input.durationSeconds,
    });
  } catch (error) {
    return {
      status: 'failed',
      failureCode:
        error instanceof VideoProcessingError
          ? error.code
          : 'video_keyframe_extraction_failed',
    };
  }

  const records: VideoKeyframeRecord[] = [];
  const storedKeys: string[] = [];
  try {
    for (const frame of frames) {
      const checksum = createHash('sha256').update(frame.bytes).digest('hex');
      const stored = await input.storage.put({
        key: `assets/${input.assetVersionId}/keyframes/${VIDEO_KEYFRAME_ALGORITHM_VERSION}/${checksum}.jpg`,
        bytes: frame.bytes,
        contentType: 'image/jpeg',
      });
      storedKeys.push(stored.key);
      records.push({
        ordinal: frame.ordinal,
        timestampSeconds: frame.timestampSeconds,
        storageKey: stored.key,
        checksum: stored.checksum,
        byteSize: stored.sizeBytes,
      });
    }
  } catch {
    /* 任一帧写入失败时，这批帧尚未进入数据库/outbox；立即回收此前已写对象，
       否则 Source 删除时没有任何账本能够发现这些孤儿 key。 */
    await Promise.all(
      storedKeys.map((key) => input.storage.delete(key).catch(() => undefined)),
    );
    return { status: 'failed', failureCode: 'video_keyframe_storage_failed' };
  }

  return {
    status: 'ready',
    algorithmVersion: VIDEO_KEYFRAME_ALGORITHM_VERSION,
    frames: records,
  };
}
