import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, storage, inspect, gateway, resolveGateway } = vi.hoisted(() => ({
  repo: {
    beginAttempt: vi.fn(),
    settle: vi.fn(),
  },
  storage: {
    readVerified: vi.fn(),
  },
  inspect: vi.fn(),
  gateway: {
    transcribeAudio: vi.fn(),
  },
  resolveGateway: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  DrizzleAssetTranscriptionRepository: vi.fn(function () {
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
  return { ...actual, inspectSupportedAudioSource: inspect };
});
vi.mock('../model-runtime.js', () => ({
  resolveAudioTranscriptionModelGateway: resolveGateway,
}));

import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { transcribeAudioTask } from './transcribe-audio';

const JOB_ID = '33333333-3333-4333-8333-333333333333';
const pending = {
  storageKey: 'assets/source.wav',
  mimeType: 'audio/wav',
  byteSize: 12,
  contentHash: 'a'.repeat(64),
};
const bytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);

function run(attempts = 1, maxAttempts = 3) {
  return transcribeAudioTask({ jobId: JOB_ID }, {
    job: { attempts, max_attempts: maxAttempts },
  } as never);
}

describe('assets:transcribe_audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.beginAttempt.mockResolvedValue(pending);
    repo.settle.mockResolvedValue(true);
    storage.readVerified.mockResolvedValue(bytes);
    inspect.mockResolvedValue({
      mimeType: 'audio/wav',
      extension: 'wav',
      durationSeconds: 45,
    });
    resolveGateway.mockReturnValue(gateway);
    gateway.transcribeAudio.mockResolvedValue({
      text: '课堂录音转录',
      language: 'zh',
      durationSeconds: 44.5,
      metadata: {
        provider: 'openai-compatible',
        resolvedModelId: 'whisper-1',
        latencyMs: 120,
        traceId: `asset-transcription:${JOB_ID}`,
      },
    });
  });

  it('校验对象完整性和本地时长后写入安全转录终态', async () => {
    await run();

    expect(storage.readVerified).toHaveBeenCalledWith(
      pending.storageKey,
      pending.contentHash,
    );
    expect(gateway.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'audio/wav',
        audioBytes: bytes,
      }),
    );
    expect(repo.settle).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        transcriptionText: '课堂录音转录',
        transcriptionMetadata: expect.objectContaining({
          durationSeconds: 45,
          language: 'zh',
        }),
      },
    });
  });

  it('已终结任务不读取对象也不调用Provider', async () => {
    repo.beginAttempt.mockResolvedValue(null);
    await run();
    expect(storage.readVerified).not.toHaveBeenCalled();
    expect(gateway.transcribeAudio).not.toHaveBeenCalled();
  });

  it('MIME欺骗、字节漂移和时长超限写稳定失败码', async () => {
    inspect.mockResolvedValueOnce({
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      durationSeconds: 10,
    });
    await run();
    expect(repo.settle).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'unsupported_audio_type' },
    });

    storage.readVerified.mockResolvedValueOnce(bytes.slice(0, 4));
    await run();
    expect(repo.settle).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'failed',
        failureCode: 'audio_metadata_unavailable',
      },
    });
  });

  it('Provider确定性错误终结，限流和超时交给队列重试', async () => {
    gateway.transcribeAudio.mockRejectedValueOnce(
      new ModelGatewayInvocationError({
        code: 'invalid_response',
        retryable: false,
      }),
    );
    await run();
    expect(repo.settle).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'invalid_response' },
    });

    gateway.transcribeAudio.mockRejectedValueOnce(
      new ModelGatewayInvocationError({
        code: 'rate_limit',
        retryable: true,
      }),
    );
    await expect(run()).rejects.toMatchObject({
      normalized: { code: 'rate_limit', retryable: true },
    });
  });

  it('瞬时失败最终耗尽后写安全终态', async () => {
    gateway.transcribeAudio.mockRejectedValue(new Error('/private/provider'));
    await expect(run()).rejects.toThrow('/private/provider');
    expect(repo.settle).not.toHaveBeenCalled();

    await run(3, 3);
    expect(repo.settle).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'failed',
        failureCode: 'asset_processing_exhausted',
      },
    });
  });
});
