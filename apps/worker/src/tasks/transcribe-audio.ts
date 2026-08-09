import {
  AudioInspectionError,
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  inspectSupportedAudioSource,
} from '@educanvas/asset-processing';
import {
  ModelGatewayInvocationError,
  type SupportedAudioTranscriptionMimeType,
} from '@educanvas/agent-core';
import { DrizzleAssetTranscriptionRepository } from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { getAssetTaskStorage, sha256Hex } from './asset-task-storage.js';

const payloadSchema = z.object({ jobId: z.string().uuid() }).strict();

const audioMimeTypes = new Set<SupportedAudioTranscriptionMimeType>([
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
]);

const sameAudioFormat = (detected: string, stored: string): boolean =>
  detected === stored ||
  (detected === 'audio/x-m4a' && stored === 'audio/mp4') ||
  (detected === 'audio/mp4' && stored === 'audio/x-m4a');

/**
 * 异步转录音频来源（ADR-0010）。
 *
 * 幂等由仓储保证：`beginAudioTranscriptionAttempt` 只领取 queued/running 的任务，
 * `settleAudioTranscription` 也只从这两个状态推进，所以 graphile-worker 的重投
 * 不会把已经就绪的转录改回去，也不会重复写入 transcriptionText。
 *
 * 失败分两类：
 * - **确定性失败**（不支持的格式、空音频）：直接写终态 failed，不重试
 * - **瞬时失败**（网络、供应商）：抛给 graphile-worker 退避重试
 *
 * 转录文本是派生内容，写入 transcriptionText 列，不覆盖 extractedText。
 * Provider 原始响应止步于 model-gateway，只返回归一化文本与审计元数据。
 */
export const transcribeAudioTask: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const assets = new DrizzleAssetTranscriptionRepository();

  const pending = await assets.beginAttempt({
    jobId: payload.jobId,
  });
  /* 任务已终结（重复投递或已被人工处置）：安静退出，不当作错误。 */
  if (!pending) return;

  try {
    if (
      !audioMimeTypes.has(
        pending.mimeType as SupportedAudioTranscriptionMimeType,
      )
    ) {
      throw new AudioInspectionError('unsupported_audio_type');
    }
    if (
      pending.byteSize <= 0 ||
      pending.byteSize > AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES
    ) {
      throw new AudioInspectionError('audio_input_too_large');
    }
    const storage = await getAssetTaskStorage();
    const bytes = await storage.readVerified(
      pending.storageKey,
      pending.contentHash,
    );
    if (bytes.byteLength !== pending.byteSize) {
      throw new AudioInspectionError('audio_metadata_unavailable');
    }
    const inspected = await inspectSupportedAudioSource(bytes);
    if (!sameAudioFormat(inspected.mimeType, pending.mimeType)) {
      throw new AudioInspectionError('unsupported_audio_type');
    }

    // 动态导入避免无 Provider 配置时的 Worker 启动报错。
    const { resolveAudioTranscriptionModelGateway } =
      await import('../model-runtime.js');
    const gateway = resolveAudioTranscriptionModelGateway();
    if (!gateway) {
      throw new Error('audio_transcription_provider_not_configured');
    }
    const result = await gateway.transcribeAudio({
      taskAlias: 'audio.transcribe',
      modelAlias: 'transcription',
      audioBytes: bytes,
      mimeType: pending.mimeType as SupportedAudioTranscriptionMimeType,
      promptVersion: 'audio-transcription-v1',
      traceId: `asset-transcription:${payload.jobId}`,
      operationId: payload.jobId,
    });

    /* 转录网关只返回文本+审计元数据；原始音频响应与供应商错误堆栈不入业务落库，
       避免跨 Worker/浏览器边界泄露内部调用细节。 */
    /* D04：转录文本内容写入对象存储（内容权威 = transcription representation
       的 derivedStorageKey）；旧字段仅在兼容窗口内作为同事务镜像。 */
    const transcriptionKey = `derived/transcription/${payload.jobId}/${sha256Hex(
      new TextEncoder().encode(result.text),
    )}.txt`;
    await storage.put({
      key: transcriptionKey,
      bytes: new TextEncoder().encode(result.text),
      contentType: 'text/plain; charset=utf-8',
    });
    await assets.settle({
      jobId: payload.jobId,
      outcome: {
        status: 'ready',
        derivedStorageKey: transcriptionKey,
        checksum: sha256Hex(new TextEncoder().encode(result.text)),
        transcriptionText: result.text,
        transcriptionMetadata: {
          provider: result.metadata.provider,
          resolvedModelId: result.metadata.resolvedModelId,
          latencyMs: result.metadata.latencyMs,
          traceId: result.metadata.traceId,
          language: result.language,
          // 本地完整容器解析是时长策略的权威事实，不能信任 Provider 回包。
          durationSeconds: inspected.durationSeconds,
        },
      },
    });
  } catch (error) {
    const isDeterministic =
      error instanceof AudioInspectionError ||
      (error instanceof ModelGatewayInvocationError &&
        !error.normalized.retryable);

    if (isDeterministic) {
      const code =
        error instanceof AudioInspectionError
          ? error.code
          : error.normalized.code;
      await assets.settle({
        jobId: payload.jobId,
        outcome: { status: 'failed', failureCode: code },
      });
      return;
    }

    /*
     * Graphile 在领取任务时已把 helpers.job.attempts 加一。最后一次仍失败时，
     * 不能只让队列永久失败而把业务账本留在 running；只落稳定失败码，不保存
     * 原始异常、路径或堆栈。较早的尝试继续抛出，由 Graphile 按策略退避重试。
     */
    if (helpers.job.attempts >= helpers.job.max_attempts) {
      await assets.settle({
        jobId: payload.jobId,
        outcome: {
          status: 'failed',
          failureCode: 'asset_processing_exhausted',
        },
      });
      return;
    }
    throw error;
  }
};
