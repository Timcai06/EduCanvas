import { describe, expect, it, vi } from 'vitest';
import { AssetAccessError, type AssetSnapshot } from '@educanvas/db';
import {
  GatewayAssetUploadError,
  GatewayAssetUploadService,
  type GatewayAssetUploadPort,
} from './asset-upload';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const assetId = `asset:${uuid}`;
const versionId = `version:${uuid}`;

function snapshot(status: 'ready' | 'processing'): AssetSnapshot {
  return {
    descriptor: {
      assetId,
      scope: 'space',
      kind: 'image',
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
    processing: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  };
}

function pngFile(name = '截图.png'): File {
  return new File(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    name,
    {
      type: 'image/png',
    },
  );
}

function pdfFile(): File {
  return new File([new TextEncoder().encode('%PDF-1.7 fake')], '笔记.pdf', {
    type: 'application/pdf',
  });
}

function createStub(
  overrides: Partial<GatewayAssetUploadPort> = {},
): GatewayAssetUploadPort {
  return {
    createUploaded: vi.fn().mockResolvedValue(snapshot('ready')),
    createUploadedPending: vi.fn().mockResolvedValue({
      snapshot: snapshot('processing'),
      versionId,
      jobId: uuid,
    }),
    getOwnedSnapshot: vi.fn().mockResolvedValue(snapshot('ready')),
    storeBytes: vi.fn().mockResolvedValue({
      storageKey: `assets/${'a'.repeat(16)}/${uuid}.png`,
      absolutePath: 'C:/uploads/irrelevant.png',
    }),
    removeStored: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const baseInput = {
  trustedSubjectId: 'user:one',
  notebookId: uuid,
  scope: 'space' as const,
};

describe('GatewayAssetUploadService (DP10)', () => {
  it('writes images as ready immediately', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    const result = await service.upload({ ...baseInput, file: pngFile() });
    expect(result.descriptor.status).toBe('ready');
    expect(deps.createUploaded).toHaveBeenCalledOnce();
    expect(deps.createUploadedPending).not.toHaveBeenCalled();
  });

  it('routes PDF to the async extraction queue as processing', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    const result = await service.upload({ ...baseInput, file: pdfFile() });
    expect(result.descriptor.status).toBe('processing');
    expect(deps.createUploadedPending).toHaveBeenCalledOnce();
    expect(deps.createUploaded).not.toHaveBeenCalled();
  });

  it('rejects files over 25MB with FILE_TOO_LARGE', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    const huge = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'big.png');
    await expect(
      service.upload({ ...baseInput, file: huge }),
    ).rejects.toMatchObject({
      status: 413,
      code: 'FILE_TOO_LARGE',
    } satisfies Partial<GatewayAssetUploadError>);
    expect(deps.storeBytes).not.toHaveBeenCalled();
  });

  it('rejects zero-byte files with INVALID_REQUEST', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    await expect(
      service.upload({ ...baseInput, file: new File([], 'empty.png') }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    } satisfies Partial<GatewayAssetUploadError>);
  });

  it('rejects unsupported payloads with UNSUPPORTED_MEDIA', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    await expect(
      service.upload({
        ...baseInput,
        file: new File([new TextEncoder().encode('hello world')], 'x.txt'),
      }),
    ).rejects.toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_MEDIA',
    } satisfies Partial<GatewayAssetUploadError>);
    expect(deps.storeBytes).not.toHaveBeenCalled();
  });

  it('cleans up a stored object when persistence fails', async () => {
    const deps = createStub({
      createUploaded: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const service = new GatewayAssetUploadService(deps);
    await expect(
      service.upload({ ...baseInput, file: pngFile() }),
    ).rejects.toThrow('db down');
    expect(deps.removeStored).toHaveBeenCalledOnce();
  });

  it('does not clean up storage when the size guard itself fails', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    await expect(
      service.upload({ ...baseInput, file: new File([], 'empty.png') }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(deps.storeBytes).not.toHaveBeenCalled();
    expect(deps.removeStored).not.toHaveBeenCalled();
  });

  it('returns only owned snapshots and maps access failures to NOT_FOUND', async () => {
    const deps = createStub();
    const service = new GatewayAssetUploadService(deps);
    await expect(
      service.get({ trustedSubjectId: 'user:one', notebookId: uuid, assetId }),
    ).resolves.toMatchObject({ descriptor: { assetId } });

    const denied = createStub({
      getOwnedSnapshot: vi.fn().mockRejectedValue(new AssetAccessError()),
    });
    await expect(
      new GatewayAssetUploadService(denied).get({
        trustedSubjectId: 'user:two',
        notebookId: uuid,
        assetId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    } satisfies Partial<GatewayAssetUploadError>);
  });
});
