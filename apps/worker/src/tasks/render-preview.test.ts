import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, storage, render } = vi.hoisted(() => ({
  repo: {
    beginPreviewRenderAttempt: vi.fn(),
    settlePreviewRender: vi.fn(),
  },
  storage: {
    readVerified: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  render: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  DrizzleAssetDerivedProcessingRepository: vi.fn(function () {
    return repo;
  }),
}));

vi.mock('./asset-task-storage.js', () => ({
  getAssetTaskStorage: vi.fn(async () => storage),
  sha256Hex: vi.fn(() => 'a'.repeat(64)),
}));

vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return { ...actual, renderAssetPreview: render };
});

import {
  ASSET_PREVIEW_MAX_INPUT_BYTES,
  AssetPreviewError,
} from '@educanvas/asset-processing';
import { renderPreviewTask } from './render-preview';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const pending = {
  storageKey: 'assets/source.pdf',
  mimeType: 'application/pdf',
  byteSize: 4,
  contentHash: 'b'.repeat(64),
};

function run(attempts = 1, maxAttempts = 3) {
  return renderPreviewTask({ jobId: JOB_ID }, {
    job: { attempts, max_attempts: maxAttempts },
  } as never);
}

describe('assets:render_preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.beginPreviewRenderAttempt.mockResolvedValue(pending);
    repo.settlePreviewRender.mockResolvedValue(true);
    storage.readVerified.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    storage.put.mockResolvedValue({
      key: `derived/preview/${JOB_ID}/aaaaaaaaaaaaaaaa.html`,
      checksum: 'c'.repeat(64),
      sizeBytes: 16,
    });
    render.mockResolvedValue({
      html: '<div>课程资料</div>',
      mimeType: 'text/html',
    });
  });

  it('已终结任务安静退出', async () => {
    repo.beginPreviewRenderAttempt.mockResolvedValue(null);

    await run();

    expect(storage.readVerified).not.toHaveBeenCalled();
    expect(repo.settlePreviewRender).not.toHaveBeenCalled();
  });

  it('校验原对象并写入 ready 派生表示', async () => {
    await run();

    expect(storage.readVerified).toHaveBeenCalledWith(
      pending.storageKey,
      pending.contentHash,
    );
    expect(repo.settlePreviewRender).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        derivedStorageKey: `derived/preview/${JOB_ID}/aaaaaaaaaaaaaaaa.html`,
        checksum: 'c'.repeat(64),
        byteSize: 16,
      },
    });
  });

  it('未知 MIME 与大小超限不读取对象并写稳定失败码', async () => {
    repo.beginPreviewRenderAttempt.mockResolvedValueOnce({
      ...pending,
      mimeType: 'image/png',
    });
    await run();
    expect(repo.settlePreviewRender).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'unsupported_media_type' },
    });

    repo.beginPreviewRenderAttempt.mockResolvedValueOnce({
      ...pending,
      byteSize: ASSET_PREVIEW_MAX_INPUT_BYTES + 1,
    });
    await run();
    expect(repo.settlePreviewRender).toHaveBeenLastCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'preview_input_too_large' },
    });
    expect(storage.readVerified).not.toHaveBeenCalled();
  });

  it('损坏内容是确定性失败，原始异常不入库', async () => {
    render.mockRejectedValue(
      new AssetPreviewError('pdf_preview_unavailable', {
        cause: new Error('/private/path.pdf'),
      }),
    );

    await run();

    expect(repo.settlePreviewRender).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'pdf_preview_unavailable' },
    });
    expect(JSON.stringify(repo.settlePreviewRender.mock.calls)).not.toContain(
      '/private/path.pdf',
    );
  });

  it('瞬时读取失败交给队列重试，最终耗尽才写安全终态', async () => {
    storage.readVerified.mockRejectedValue(new Error('EACCES /private/file'));

    await expect(run()).rejects.toThrow('EACCES');
    expect(repo.settlePreviewRender).not.toHaveBeenCalled();

    await run(3, 3);
    expect(repo.settlePreviewRender).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'failed',
        failureCode: 'asset_processing_exhausted',
      },
    });
  });

  it('结算已失效任务时删除刚写入的无主派生对象', async () => {
    repo.settlePreviewRender.mockResolvedValue(false);

    await run();

    expect(storage.delete).toHaveBeenCalledWith(
      `derived/preview/${JOB_ID}/aaaaaaaaaaaaaaaa.html`,
    );
  });
});
