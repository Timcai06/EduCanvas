import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { loadOwnedCurrentStoredVersion, getAccessPolicy } = vi.hoisted(() => ({
  loadOwnedCurrentStoredVersion: vi.fn(),
  getAccessPolicy: vi.fn(),
}));
vi.mock('@educanvas/db', () => ({
  AssetAccessError: class AssetAccessError extends Error {},
  DrizzleAssetRepository: vi.fn(function () {
    return { loadOwnedCurrentStoredVersion, getAccessPolicy };
  }),
}));

const { convertToHtml } = vi.hoisted(() => ({ convertToHtml: vi.fn() }));
vi.mock('mammoth', () => ({ default: { convertToHtml } }));

vi.mock('@educanvas/canvas-protocol/server', () => ({
  projectOwnedSourceResource: vi.fn(() => ({ resourceId: 'resource-x' })),
}));

const { readStoredAssetBytes } = vi.hoisted(() => ({
  readStoredAssetBytes: vi.fn(),
}));
vi.mock('./asset-storage', () => ({ readStoredAssetBytes }));

import type { OwnedStoredAssetVersion } from '@educanvas/db';
import {
  AssetPreviewError,
  loadOwnedAssetPreviewDetail,
  readOwnedAssetDownload,
} from './asset-preview';

const ASSET_ID = '10000000-0000-4000-8000-000000000001';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const identity = { token: 'token', studentId: 'owner-1' };
const spaceId = '20000000-0000-4000-8000-000000000002';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml';

const MD_TEXT = '# 光合作用\n\n![叶绿体](images/001.jpg)\n\n正文。';
const MD_SHA = createHash('sha256').update(MD_TEXT, 'utf8').digest('hex');

type TextQuality = NonNullable<
  OwnedStoredAssetVersion['textRepresentation']
>['quality'];

function textRepresentation(quality: TextQuality = 'structured') {
  return {
    derivedStorageKey: `derived/${JOB_ID}/index.md`,
    checksum: MD_SHA,
    status: 'ready' as const,
    quality,
    mimeType: 'text/markdown',
    producer: 'mineru',
    producerVersion: '3.4.4',
  };
}

function version(
  overrides: Partial<OwnedStoredAssetVersion> = {},
): OwnedStoredAssetVersion {
  return {
    assetId: ASSET_ID,
    versionId: '30000000-0000-4000-8000-000000000003',
    displayName: '讲义.docx',
    mimeType: DOCX_MIME,
    byteSize: 11,
    contentHash: 'b'.repeat(64),
    origin: 'upload',
    createdAt: '2026-07-25T00:00:00.000Z',
    storageKey: 'assets/aaaaaaaaaaaaaaaa/lesson.docx',
    extractedText: null,
    transcriptionText: null,
    transcriptionMetadata: null,
    derivedStatuses: [],
    transcriptionRepresentation: null,
    textRepresentation: null,
    ...overrides,
  };
}

describe('loadOwnedAssetPreviewDetail docx 分支（ADR-0026 决定 2/6）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOwnedCurrentStoredVersion.mockResolvedValue(version());
    getAccessPolicy.mockResolvedValue({ role: 'owner' });
    readStoredAssetBytes.mockImplementation((key: string) => {
      /* 派生 md 与原件分别落 mock：mammoth 回退路径也要读原件。 */
      if (key.endsWith('/index.md')) {
        return Buffer.from(MD_TEXT, 'utf8');
      }
      if (key.startsWith('assets/')) {
        return Buffer.from('DOCX 原始字节');
      }
      throw new Error('asset_object_missing');
    });
  });

  it('结构化表示可用时跳过 mammoth，投影图片引用并保留原件下载', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({ textRepresentation: textRepresentation('structured') }),
    );

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    expect(preview.kind).toBe('docx');
    if (preview.kind !== 'docx') return;
    expect(preview.content).toBe('');
    expect(preview.representation).toMatchObject({
      quality: 'structured',
    });
    /* C4 投影：images/ 引用被重写为鉴权资源 URL，不暴露对象 key。 */
    expect(preview.representation?.markdown).toContain(
      `/api/v1/chat/assets/${ASSET_ID}/resources/images/001.jpg`,
    );
    expect(preview.representation?.markdown).not.toContain('derived/');
    expect(preview.downloadUrl).toBe(
      `/api/v1/chat/assets/${ASSET_ID}/file?download=1`,
    );
    expect(convertToHtml).not.toHaveBeenCalled();
  });

  it('降级纯文本时回退 mammoth 并透传质量', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({
        textRepresentation: textRepresentation('degraded_plain_text'),
      }),
    );
    convertToHtml.mockResolvedValue({
      value: '<p>正文</p>',
      messages: [],
    });

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'docx') return;
    expect(preview.content).toBe('<p>正文</p>');
    expect(preview.representation?.quality).toBe('degraded_plain_text');
    /* degraded 也投影派生文本（与 PDF 分支同构），降级由前端标注 provenance。 */
    expect(preview.representation?.markdown).toContain(
      `/api/v1/chat/assets/${ASSET_ID}/resources/images/001.jpg`,
    );
    expect(convertToHtml).toHaveBeenCalledTimes(1);
  });

  it.each(['processing', 'failed'] as const)(
    '质量 %s 时保持原格式预览并显示状态',
    async (quality) => {
      loadOwnedCurrentStoredVersion.mockResolvedValue(
        version({ textRepresentation: textRepresentation(quality) }),
      );
      convertToHtml.mockResolvedValue({ value: '<p>正文</p>', messages: [] });

      const { preview } = await loadOwnedAssetPreviewDetail({
        identity,
        spaceId,
        assetId: ASSET_ID,
      });

      if (preview.kind !== 'docx') return;
      expect(preview.representation?.quality).toBe(quality);
      expect(preview.content).toBe('<p>正文</p>');
    },
  );

  it('无 text 表示（旧资产）保持 mammoth 且 representation 为 null', async () => {
    convertToHtml.mockResolvedValue({ value: '<p>正文</p>', messages: [] });

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'docx') return;
    expect(preview.representation).toBeNull();
    expect(preview.downloadUrl).toBe(
      `/api/v1/chat/assets/${ASSET_ID}/file?download=1`,
    );
  });

  it('派生对象校验和与声明不一致时回退 mammoth，不展示被篡改内容', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({ textRepresentation: textRepresentation('structured') }),
    );
    /* 对象字节与 checksum 声明不符。 */
    readStoredAssetBytes.mockResolvedValue(Buffer.from('被篡改的内容', 'utf8'));
    convertToHtml.mockResolvedValue({ value: '<p>正文</p>', messages: [] });

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'docx') return;
    expect(preview.content).toBe('<p>正文</p>');
    expect(preview.representation?.markdown).toBeUndefined();
  });

  it('派生对象缺失时回退 mammoth', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({ textRepresentation: textRepresentation('structured') }),
    );
    readStoredAssetBytes.mockImplementation((key: string) => {
      if (key.endsWith('/index.md')) throw new Error('ENOENT');
      return Buffer.from('DOCX 原始字节');
    });
    convertToHtml.mockResolvedValue({ value: '<p>正文</p>', messages: [] });

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'docx') return;
    expect(preview.content).toBe('<p>正文</p>');
  });
});

describe('loadOwnedAssetPreviewDetail pdf 分支（结构化阅读接入）', () => {
  const PDF_MIME = 'application/pdf';

  beforeEach(() => {
    vi.clearAllMocks();
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({ mimeType: PDF_MIME, displayName: '网络编程.pdf' }),
    );
    getAccessPolicy.mockResolvedValue({ role: 'owner' });
    readStoredAssetBytes.mockImplementation((key: string) => {
      if (key.endsWith('/index.md')) {
        return Buffer.from(MD_TEXT, 'utf8');
      }
      throw new Error('asset_object_missing');
    });
  });

  it('结构化表示可用时投影图片引用，保留原 PDF 预览地址', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({
        mimeType: PDF_MIME,
        displayName: '网络编程.pdf',
        textRepresentation: textRepresentation('structured'),
      }),
    );

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    expect(preview.kind).toBe('pdf');
    if (preview.kind !== 'pdf') return;
    expect(preview.fileUrl).toBe(`/api/v1/chat/assets/${ASSET_ID}/file`);
    expect(preview.representation).toMatchObject({
      quality: 'structured',
      producer: 'mineru',
      producerVersion: '3.4.4',
    });
    /* C4 投影：images/ 引用被重写为鉴权资源 URL，不暴露对象 key。 */
    expect(preview.representation?.markdown).toContain(
      `/api/v1/chat/assets/${ASSET_ID}/resources/images/001.jpg`,
    );
    expect(preview.representation?.markdown).not.toContain('derived/');
  });

  it('降级纯文本时透传质量并投影降级文本（provenance 标注用），仍保留原 PDF 预览', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({
        mimeType: PDF_MIME,
        displayName: '网络编程.pdf',
        textRepresentation: textRepresentation('degraded_plain_text'),
      }),
    );

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'pdf') return;
    expect(preview.representation?.quality).toBe('degraded_plain_text');
    /* C4 投影与 structured 一致：降级文本同样投影为鉴权资源 URL。 */
    expect(preview.representation?.markdown).toContain(
      `/api/v1/chat/assets/${ASSET_ID}/resources/images/001.jpg`,
    );
    expect(preview.fileUrl).toBe(`/api/v1/chat/assets/${ASSET_ID}/file`);
  });

  it('无 text 表示（旧资产）时 representation 为 null，仍可原 PDF 预览', async () => {
    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'pdf') return;
    expect(preview.representation).toBeNull();
    expect(preview.fileUrl).toBe(`/api/v1/chat/assets/${ASSET_ID}/file`);
  });

  it('派生对象校验和与声明不一致时回退（markdown 不展示），质量透传', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({
        mimeType: PDF_MIME,
        displayName: '网络编程.pdf',
        textRepresentation: {
          ...textRepresentation('structured'),
          checksum: 'a'.repeat(64),
        },
      }),
    );

    const { preview } = await loadOwnedAssetPreviewDetail({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    if (preview.kind !== 'pdf') return;
    expect(preview.representation?.quality).toBe('structured');
    expect(preview.representation?.markdown).toBeUndefined();
    expect(preview.fileUrl).toBe(`/api/v1/chat/assets/${ASSET_ID}/file`);
  });
});

describe('readOwnedAssetDownload（ADR-0026 决定 1 原件下载）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessPolicy.mockResolvedValue({ role: 'owner' });
  });

  it('返回与 Version 声明一致的原件字节', async () => {
    const bytes = Buffer.from('DOCX 原始字节');
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({
        byteSize: bytes.byteLength,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
    readStoredAssetBytes.mockResolvedValue(bytes);

    const file = await readOwnedAssetDownload({
      identity,
      spaceId,
      assetId: ASSET_ID,
    });

    expect(file.bytes).toEqual(bytes);
    expect(file.mimeType).toBe(DOCX_MIME);
    expect(file.fileName).toBe('讲义.docx');
  });

  it('字节数与内容 hash 不一致按 422 拒绝，防止篡改对象外泄', async () => {
    loadOwnedCurrentStoredVersion.mockResolvedValue(
      version({
        byteSize: 100,
        contentHash: 'c'.repeat(64),
      }),
    );
    readStoredAssetBytes.mockResolvedValue(Buffer.from('不是原件'));

    await expect(
      readOwnedAssetDownload({ identity, spaceId, assetId: ASSET_ID }),
    ).rejects.toBeInstanceOf(AssetPreviewError);
  });
});
