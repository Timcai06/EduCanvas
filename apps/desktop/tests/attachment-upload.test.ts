import { describe, expect, it, vi } from 'vitest';
import type { GatewayAssetSnapshot } from '@educanvas/gateway-core';
import {
  createAttachmentUpload,
  type DesktopAttachmentUploadDeps,
} from '../src/main/attachment-upload';

const assetId = 'asset:one';
const versionId = 'version:one';

function snapshot(
  status: 'ready' | 'processing' | 'failed',
): GatewayAssetSnapshot {
  return {
    descriptor: {
      assetId,
      scope: 'space',
      kind: status === 'failed' ? 'document' : 'image',
      origin: 'upload',
      displayName: '截图.png',
      mimeType: 'image/png',
      status,
      currentVersionId: status === 'ready' ? versionId : null,
    },
    version:
      status === 'ready'
        ? {
            assetId,
            versionId,
            kind: 'image',
            mimeType: 'image/png',
            byteSize: 4,
            contentHash: 'a'.repeat(64),
            status: 'ready',
          }
        : null,
  };
}

const pngFile = () =>
  new File(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    '截图.png',
    {
      type: 'image/png',
    },
  );

function createDeps(overrides: Partial<DesktopAttachmentUploadDeps> = {}): {
  deps: DesktopAttachmentUploadDeps;
  clock: { now: number };
  uploads: ReturnType<typeof vi.fn>;
  gets: ReturnType<typeof vi.fn>;
} {
  const clock = { now: 0 };
  const uploads = vi.fn();
  const gets = vi.fn();
  const deps: DesktopAttachmentUploadDeps = {
    showOpenDialog: vi
      .fn()
      .mockResolvedValue({ canceled: false, filePaths: ['C:/pic.png'] }),
    readFileAsUpload: vi.fn().mockResolvedValue(pngFile()),
    uploadAsset: uploads,
    getAsset: gets,
    sleep: vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => clock.now),
    ...overrides,
  };
  return { deps, clock, uploads, gets };
}

describe('createAttachmentUpload (DP10)', () => {
  const client = {} as never;

  it('cancels without uploading when the dialog is dismissed', async () => {
    const { deps } = createDeps({
      showOpenDialog: vi
        .fn()
        .mockResolvedValue({ canceled: true, filePaths: [] }),
    });
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result).toEqual({ ok: false, message: '已取消选择附件。' });
    expect(deps.uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects files over 25MB before uploading', async () => {
    const { deps } = createDeps({
      readFileAsUpload: vi
        .fn()
        .mockResolvedValue(
          new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'big.png'),
        ),
    });
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result).toEqual({ ok: false, message: '附件不能为空或超过25MB。' });
    expect(deps.uploadAsset).not.toHaveBeenCalled();
  });

  it('returns a ready image immediately with a usable version id', async () => {
    const { deps, uploads } = createDeps();
    uploads.mockResolvedValue(snapshot('ready'));
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result).toEqual({
      ok: true,
      attachment: {
        assetId,
        versionId,
        kind: 'image',
        mimeType: 'image/png',
        displayName: '截图.png',
        notebookId: 'nb:1',
      },
    });
    expect(deps.getAsset).not.toHaveBeenCalled();
  });

  it('polls a processing PDF until ready', async () => {
    const { deps, uploads, gets } = createDeps();
    uploads.mockResolvedValue(snapshot('processing'));
    gets
      .mockResolvedValueOnce(snapshot('processing'))
      .mockResolvedValueOnce(snapshot('ready'));
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment.versionId).toBe(versionId);
    expect(gets).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed processing state', async () => {
    const { deps, uploads, gets } = createDeps();
    uploads.mockResolvedValue(snapshot('processing'));
    gets.mockResolvedValue(snapshot('failed'));
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result).toEqual({
      ok: false,
      message: '文件处理失败，暂时无法使用。',
    });
  });

  it('times out after the deadline and does not loop forever', async () => {
    const { deps, uploads, gets } = createDeps();
    uploads.mockResolvedValue(snapshot('processing'));
    gets.mockResolvedValue(snapshot('processing'));
    // 截止线取 start=0 → deadline=60s；首次轮询时已到 60s 之后，立即超时。
    vi.mocked(deps.now).mockReturnValueOnce(0).mockReturnValue(60_001);
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result).toEqual({
      ok: false,
      message: '文件处理超时，请稍后重试。',
    });
    expect(gets).toHaveBeenCalledTimes(0);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('maps an upload failure to a friendly message', async () => {
    const { deps, uploads } = createDeps();
    uploads.mockRejectedValue(new Error('network down'));
    const result = await createAttachmentUpload(deps).pickAndUpload(
      client,
      'nb:1',
    );
    expect(result).toEqual({
      ok: false,
      message: '上传失败，请检查网络后重试。',
    });
  });
});
