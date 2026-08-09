import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, storage, probe, extractAudio, extractFrames, resolveGateway } =
  vi.hoisted(() => ({
    repo: {
      beginAttempt: vi.fn(),
      settleProcessed: vi.fn(),
      settleFailed: vi.fn(),
    },
    storage: { readVerified: vi.fn(), put: vi.fn(), delete: vi.fn() },
    probe: vi.fn(),
    extractAudio: vi.fn(),
    extractFrames: vi.fn(),
    resolveGateway: vi.fn(),
  }));

vi.mock('@educanvas/db', () => ({
  DrizzleAssetVideoRepository: vi.fn(function () {
    return repo;
  }),
}));
vi.mock('./asset-task-storage.js', () => ({
  getAssetTaskStorage: vi.fn(async () => storage),
}));
vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return {
    ...actual,
    probeVideoFile: probe,
    extractVideoAudioTrack: extractAudio,
    extractVideoKeyframes: extractFrames,
    /* 真实 workspace 会写临时文件；这里只验证编排，不验证文件系统。 */
    withVideoWorkspace: vi.fn(
      async (
        _bytes: Uint8Array,
        _extension: string,
        operation: (input: {
          filePath: string;
          workingDirectory: string;
        }) => Promise<unknown>,
      ) =>
        operation({
          filePath: '/tmp/fixture/source.mp4',
          workingDirectory: '/tmp/fixture',
        }),
    ),
  };
});
vi.mock('../model-runtime.js', () => ({
  resolveAudioTranscriptionModelGateway: resolveGateway,
}));

import {
  VideoProcessingError,
  VIDEO_KEYFRAME_ALGORITHM_VERSION,
} from '@educanvas/asset-processing';
import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { processVideoTask } from './process-video';

const JOB_ID = '44444444-4444-4444-8444-444444444444';
const VERSION_ID = '55555555-5555-4555-8555-555555555555';

/** 带 `isom` 主 brand 的最小 ISO-BMFF 头，Worker 侧会重新按 brand 判定。 */
const MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

const pending = {
  assetVersionId: VERSION_ID,
  storageKey: 'assets/source.mp4',
  mimeType: 'video/mp4',
  byteSize: MP4_BYTES.byteLength,
  contentHash: 'a'.repeat(64),
};

function run(attempts = 1, maxAttempts = 3) {
  return processVideoTask({ jobId: JOB_ID }, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    job: { attempts, max_attempts: maxAttempts },
  } as never);
}

describe('assets:process_video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.beginAttempt.mockResolvedValue(pending);
    repo.settleProcessed.mockResolvedValue(true);
    repo.settleFailed.mockResolvedValue(true);
    storage.readVerified.mockResolvedValue(MP4_BYTES);
    storage.delete.mockResolvedValue(undefined);
    storage.put.mockImplementation(
      async (input: { key: string; bytes: Uint8Array }) => ({
        key: input.key,
        checksum: 'b'.repeat(64),
        sizeBytes: input.bytes.byteLength,
      }),
    );
    probe.mockResolvedValue({
      durationSeconds: 120,
      width: 1280,
      height: 720,
      hasAudioTrack: true,
    });
    extractAudio.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    extractFrames.mockResolvedValue([
      { ordinal: 1, timestampSeconds: 15, bytes: new Uint8Array([9, 9]) },
      { ordinal: 2, timestampSeconds: 45, bytes: new Uint8Array([8, 8]) },
    ]);
    resolveGateway.mockReturnValue({
      transcribeAudio: vi.fn().mockResolvedValue({
        text: '课堂视频讲解',
        language: 'zh',
        durationSeconds: 119,
        metadata: {
          provider: 'openai-compatible',
          resolvedModelId: 'whisper-1',
          latencyMs: 200,
          traceId: `asset-video:${JOB_ID}`,
        },
      }),
    });
  });

  it('探测→音轨转录→抽帧全部成功时写入完整派生事实', async () => {
    await run();

    const outcome = repo.settleProcessed.mock.calls[0]![0].outcome;
    expect(outcome).toMatchObject({
      durationSeconds: 120,
      width: 1280,
      height: 720,
      transcription: { status: 'ready', text: '课堂视频讲解' },
      keyframes: {
        status: 'ready',
        algorithmVersion: VIDEO_KEYFRAME_ALGORITHM_VERSION,
      },
    });
    /* 时长以本地容器解析为权威，不采信 Provider 回包的 119。 */
    expect(outcome.transcription.metadata.durationSeconds).toBe(120);
    expect(outcome.transcription).toMatchObject({
      derivedStorageKey: expect.stringMatching(
        new RegExp(`^derived/transcription/${JOB_ID}/[a-f0-9]{64}\\.txt$`),
      ),
      checksum: 'b'.repeat(64),
    });
    expect(outcome.keyframes.frames).toHaveLength(2);
    /* 对象键由内容哈希派生，重投得到同一个键。 */
    expect(outcome.keyframes.frames[0].storageKey).toContain(
      `assets/${VERSION_ID}/keyframes/${VIDEO_KEYFRAME_ALGORITHM_VERSION}/`,
    );
    expect(repo.settleFailed).not.toHaveBeenCalled();
  });

  it('无音轨时转录标记 unavailable，不算失败', async () => {
    probe.mockResolvedValue({
      durationSeconds: 30,
      width: 640,
      height: 480,
      hasAudioTrack: false,
    });

    await run();

    expect(repo.settleProcessed.mock.calls[0]![0].outcome).toMatchObject({
      transcription: { status: 'unavailable' },
      keyframes: { status: 'ready' },
    });
    expect(extractAudio).not.toHaveBeenCalled();
  });

  it('抽帧失败不拖垮已成功的转录（部分成功）', async () => {
    extractFrames.mockRejectedValue(
      new VideoProcessingError('video_keyframe_extraction_failed'),
    );

    await run();

    expect(repo.settleProcessed.mock.calls[0]![0].outcome).toMatchObject({
      transcription: { status: 'ready' },
      keyframes: {
        status: 'failed',
        failureCode: 'video_keyframe_extraction_failed',
      },
    });
    expect(repo.settleFailed).not.toHaveBeenCalled();
  });

  it('关键帧对象中途写入失败时回收本批已写对象', async () => {
    storage.put
      .mockResolvedValueOnce({
        key: `derived/transcription/${JOB_ID}/${'a'.repeat(64)}.txt`,
        checksum: 'a'.repeat(64),
        sizeBytes: 8,
      })
      .mockResolvedValueOnce({
        key: 'assets/frame-1.jpg',
        checksum: 'b'.repeat(64),
        sizeBytes: 2,
      })
      .mockRejectedValueOnce(new Error('storage_unavailable'));

    await run();

    expect(storage.delete).toHaveBeenCalledWith('assets/frame-1.jpg');
    expect(repo.settleProcessed.mock.calls[0]![0].outcome).toMatchObject({
      transcription: { status: 'ready' },
      keyframes: {
        status: 'failed',
        failureCode: 'video_keyframe_storage_failed',
      },
    });
  });

  it('转录失败不拖垮已成功的抽帧（反向部分成功）', async () => {
    resolveGateway.mockReturnValue({
      transcribeAudio: vi.fn().mockRejectedValue(
        new ModelGatewayInvocationError({
          code: 'content_filtered',
          retryable: false,
        }),
      ),
    });

    await run();

    expect(repo.settleProcessed.mock.calls[0]![0].outcome).toMatchObject({
      transcription: {
        status: 'failed',
        failureCode: 'video_transcription_content_filtered',
      },
      keyframes: { status: 'ready' },
    });
  });

  it('未配置转录能力时诚实标记，不静默当作无音轨', async () => {
    resolveGateway.mockReturnValue(null);

    await run();

    expect(repo.settleProcessed.mock.calls[0]![0].outcome).toMatchObject({
      transcription: {
        status: 'failed',
        failureCode: 'video_transcription_not_configured',
      },
    });
  });

  it('格式欺骗与字节漂移写整体失败终态', async () => {
    storage.readVerified.mockResolvedValueOnce(
      new Uint8Array([0x49, 0x44, 0x33, 0x04]),
    );
    await run();
    expect(repo.settleFailed).toHaveBeenLastCalledWith(
      expect.objectContaining({ failureCode: 'video_metadata_unavailable' }),
    );

    storage.readVerified.mockResolvedValueOnce(
      new Uint8Array([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
      ]),
    );
    await run();
    expect(repo.settleFailed).toHaveBeenLastCalledWith(
      expect.objectContaining({ failureCode: 'unsupported_video_type' }),
    );
    expect(repo.settleProcessed).not.toHaveBeenCalled();
  });

  it('时长与分辨率超限在探测阶段整体失败', async () => {
    probe.mockRejectedValue(
      Object.assign(new Error('video_duration_exceeded'), {
        name: 'VideoInspectionError',
        code: 'video_duration_exceeded',
      }),
    );

    /* 不是 VideoInspectionError 实例时按可重试处理，最后一次才写终态。 */
    await expect(run(1, 3)).rejects.toThrow();
    await run(3, 3);
    expect(repo.settleFailed).toHaveBeenLastCalledWith(
      expect.objectContaining({ failureCode: 'asset_processing_exhausted' }),
    );
  });

  it('工具链缺失是确定性失败，不重试', async () => {
    probe.mockRejectedValue(
      new VideoProcessingError('video_toolchain_unavailable'),
    );

    await run();

    expect(repo.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'video_toolchain_unavailable' }),
    );
  });

  it('已终结任务重复投递不读对象也不调用工具链', async () => {
    repo.beginAttempt.mockResolvedValue(null);

    await run();

    expect(storage.readVerified).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(repo.settleProcessed).not.toHaveBeenCalled();
    expect(repo.settleFailed).not.toHaveBeenCalled();
  });
});
