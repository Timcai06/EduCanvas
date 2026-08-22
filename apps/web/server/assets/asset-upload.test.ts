import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { drizzleRepo, fetchWebPage, inspectSupportedAudioSource } = vi.hoisted(
  () => ({
    drizzleRepo: {
      createUploaded: vi.fn(),
      createUploadedPending: vi.fn(),
      listOwnedSpace: vi.fn(),
    },
    fetchWebPage: vi.fn(),
    inspectSupportedAudioSource: vi.fn(),
  }),
);

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzleAssetRepository: vi.fn(function () {
      return drizzleRepo;
    }),
  };
});
vi.mock('../teaching/learning-session', () => ({
  loadOwnedTeachingGatewayTarget: vi.fn(),
}));
vi.mock('./asset-storage', () => ({
  storeAssetBytes: vi.fn(),
  removeStoredAsset: vi.fn(),
}));
vi.mock('unpdf', () => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));
vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return { ...actual, fetchWebPage, inspectSupportedAudioSource };
});

import { loadOwnedTeachingGatewayTarget } from '../teaching/learning-session';
import { removeStoredAsset, storeAssetBytes } from './asset-storage';
import {
  importOwnedLinkAsset,
  persistFetchedWebPageAsset,
  uploadOwnedAsset,
} from './asset-upload';
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { AudioInspectionError } from '@educanvas/asset-processing';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'d'.repeat(64)}`,
};

function bytesFile(bytes: readonly number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function snapshot(
  id: string,
  displayName = 'note.pdf',
  status: 'ready' | 'processing' = 'ready',
) {
  return {
    descriptor: {
      assetId: id,
      scope: 'space',
      kind: 'document',
      origin: 'upload',
      displayName,
      mimeType: 'application/pdf',
      status,
      currentVersionId: `${id}-v1`,
    },
    version: {
      assetId: id,
      versionId: `${id}-v1`,
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 4,
      contentHash: 'a'.repeat(64),
      status,
    },
    processing: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('uploadOwnedAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drizzleRepo.createUploaded.mockReset();
    drizzleRepo.createUploadedPending.mockReset();
    drizzleRepo.listOwnedSpace.mockReset();
    (loadOwnedTeachingGatewayTarget as ReturnType<typeof vi.fn>).mockReset?.();
    (storeAssetBytes as ReturnType<typeof vi.fn>).mockReset?.();
    (removeStoredAsset as ReturnType<typeof vi.fn>).mockReset?.();
    (extractText as ReturnType<typeof vi.fn>).mockReset?.();
    (getDocumentProxy as ReturnType<typeof vi.fn>).mockReset?.();
    vi.mocked(mammoth.extractRawText).mockReset();
    inspectSupportedAudioSource.mockReset();
    fetchWebPage.mockReset();
    inspectSupportedAudioSource.mockResolvedValue({
      mimeType: 'audio/wav',
      extension: 'wav',
      durationSeconds: 30,
    });

    (
      loadOwnedTeachingGatewayTarget as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ notebookId: 'space-1' });
    drizzleRepo.createUploaded.mockResolvedValue(snapshot('asset-1'));
    drizzleRepo.createUploadedPending.mockResolvedValue({
      snapshot: snapshot('asset-1', 'note.pdf', 'processing'),
      versionId: 'asset-1-v1',
      jobId: 'job-1',
    });
    vi.mocked(storeAssetBytes).mockResolvedValue({
      storageKey: 'assets/a',
      absolutePath: '/tmp/assets/a',
    });
    vi.mocked(removeStoredAsset).mockResolvedValue(undefined);
    vi.mocked(getDocumentProxy).mockResolvedValue({} as never);
  });

  it('网页导入保存原始 HTML 与安全溯源并异步入队', async () => {
    const controller = new AbortController();
    const bytes = new TextEncoder().encode(
      '<html><head><title>研究页面</title></head><body><div id="app"></div></body></html>',
    );
    const fetchedAt = new Date('2026-08-17T00:00:00.000Z');
    fetchWebPage.mockResolvedValue({
      requestedUrl: 'https://example.com/topic',
      finalUrl: 'https://www.example.com/topic',
      contentType: 'text/html',
      bytes,
      fetchedAt,
      title: '研究页面',
      summary: '',
      text: '',
    });

    await importOwnedLinkAsset({
      identity,
      spaceId: 'space-1',
      url: 'https://example.com/topic',
      signal: controller.signal,
    });

    expect(fetchWebPage).toHaveBeenCalledWith('https://example.com/topic', {
      allowEmptyText: true,
      connector: expect.any(Function),
      signal: controller.signal,
    });
    expect(storeAssetBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerSubjectId: identity.studentId,
        bytes,
        extension: 'html',
      }),
    );
    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'link',
        origin: 'url_import',
        mimeType: 'text/html',
        webSnapshot: {
          requestedUrl: 'https://example.com/topic',
          finalUrl: 'https://www.example.com/topic',
          responseContentType: 'text/html',
          pageTitle: '研究页面',
          fetchedAt,
        },
      }),
    );
  });

  it('研究来源保存本次读取的原始网页和版本溯源', async () => {
    const bytes = new TextEncoder().encode(
      '<html><body>研究正文</body></html>',
    );
    const fetchedAt = new Date('2026-08-17T00:00:00.000Z');

    await persistFetchedWebPageAsset({
      identity,
      spaceId: 'space-1',
      researchSource: true,
      page: {
        requestedUrl: 'https://example.com/research',
        url: 'https://www.example.com/research',
        title: '研究页面',
        text: '研究正文',
        bytes,
        contentType: 'text/html',
        fetchedAt,
      },
    });

    expect(storeAssetBytes).toHaveBeenCalledWith(
      expect.objectContaining({ bytes, extension: 'html' }),
    );
    expect(drizzleRepo.createUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'research_web',
        mimeType: 'text/html',
        webSnapshot: {
          requestedUrl: 'https://example.com/research',
          finalUrl: 'https://www.example.com/research',
          responseContentType: 'text/html',
          pageTitle: '研究页面',
          fetchedAt,
        },
      }),
    );
  });

  it('可抽取类型落库为待解析并立即返回，不在请求内解析', async () => {
    /* ADR-0010：上传响应时间与文件大小解耦。请求内不再调用抽取器，
       所以这里断言 unpdf 完全没有被触碰。 */
    const result = await uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x25, 0x50, 0x44, 0x46, 0x2d],
        'note.pdf',
        'application/pdf',
      ),
      scope: 'space',
    });

    expect(result).toMatchObject({ descriptor: { assetId: 'asset-1' } });
    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerSubjectId: identity.studentId,
        spaceId: 'space-1',
        scope: 'space',
        kind: 'document',
        mimeType: 'application/pdf',
      }),
    );
    expect(drizzleRepo.createUploaded).not.toHaveBeenCalled();
    expect(getDocumentProxy).not.toHaveBeenCalled();
  });

  it('DOCX 同样走异步，不在请求内跑 mammoth', async () => {
    const docxBytes = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml word/document.xml',
    );

    await uploadOwnedAsset({
      identity,
      file: new File([docxBytes], 'lesson.docx'),
      scope: 'space',
    });

    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
      }),
    );
    expect(mammoth.extractRawText).not.toHaveBeenCalled();
  });

  it('PPTX 上传落库为 processing 并排入 MinerU 转换队列（不静默当纯文本）', async () => {
    const pptxBytes = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml ppt/presentation.xml',
    );

    const result = await uploadOwnedAsset({
      identity,
      file: new File([pptxBytes], 'slides.pptx'),
      scope: 'space',
    });

    /* 状态诚实：响应如实带 processing，不冒充 ready。 */
    expect(result).toMatchObject({ descriptor: { status: 'processing' } });
    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'document',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml',
      }),
    );
    expect(drizzleRepo.createUploaded).not.toHaveBeenCalled();
  });

  it('XLSX 上传落库为 processing 并排入 MinerU 转换队列（不静默当纯文本）', async () => {
    const xlsxBytes = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml xl/workbook.xml',
    );

    const result = await uploadOwnedAsset({
      identity,
      file: new File([xlsxBytes], 'sheet.xlsx'),
      scope: 'space',
    });

    /* 状态诚实：响应如实带 processing，不冒充 ready。 */
    expect(result).toMatchObject({ descriptor: { status: 'processing' } });
    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'document',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml',
      }),
    );
    expect(drizzleRepo.createUploaded).not.toHaveBeenCalled();
  });

  it('图片不需要抽取，仍然一次性写成 ready', async () => {
    /* 为必然空转的类型建任务只会让队列和状态机变复杂。 */
    await uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        'photo.png',
        'image/png',
      ),
      scope: 'space',
    });

    expect(drizzleRepo.createUploadedPending).not.toHaveBeenCalled();
    expect(drizzleRepo.createUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'image',
        extractedText: null,
        outcome: { status: 'ready' },
      }),
    );
  });

  it('音频通过容器与时长检查后进入转录队列', async () => {
    await uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
        'lesson.wav',
        'application/octet-stream',
      ),
      scope: 'space',
    });

    expect(inspectSupportedAudioSource).toHaveBeenCalledOnce();
    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'audio',
        mimeType: 'audio/wav',
      }),
    );
  });

  it('音频超过时长上限时不写对象、不创建任务', async () => {
    inspectSupportedAudioSource.mockRejectedValue(
      new AudioInspectionError('audio_duration_exceeded'),
    );

    await expect(
      uploadOwnedAsset({
        identity,
        file: bytesFile(
          [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
          'lesson.wav',
          'audio/wav',
        ),
        scope: 'space',
      }),
    ).rejects.toMatchObject({
      code: 'audio_duration_exceeded',
      status: 422,
    });
    expect(storeAssetBytes).not.toHaveBeenCalled();
    expect(drizzleRepo.createUploadedPending).not.toHaveBeenCalled();
  });

  it('没有教学会话时直接返回会话未找到错误', async () => {
    (
      loadOwnedTeachingGatewayTarget as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile([0x25, 0x50, 0x44, 0x46], 'note.pdf', 'application/pdf'),
      scope: 'space',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'session_not_found',
      status: 404,
    });
  });

  it('非法字节流会拒绝上传', async () => {
    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x00, 0x11, 0x22],
        'note.bin',
        'application/octet-stream',
      ),
      scope: 'space',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'unsupported_file_type',
      status: 415,
    });
  });

  it('Markdown 以 document 落库并排入解析队列', async () => {
    drizzleRepo.createUploadedPending.mockResolvedValue({
      snapshot: snapshot('asset-md', 'lesson.md'),
      versionId: 'asset-md-v1',
      jobId: 'job-md',
    });

    const result = await uploadOwnedAsset({
      identity,
      file: bytesFile(
        [...new TextEncoder().encode('# 光合作用\r\n\r\n叶绿体')],
        'lesson.md',
        'text/markdown',
      ),
      scope: 'space',
    });

    expect(result.descriptor.assetId).toBe('asset-md');
    expect(drizzleRepo.createUploadedPending).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'document', mimeType: 'text/markdown' }),
    );
  });

  it('无效 UTF-8 不再在上传时报错，由 worker 写入失败终态', async () => {
    /* 行为变化：内容问题现在是解析任务的终态，不是上传响应的 4xx。
       上传只负责「受理」，用户在来源列表看到失败原因。 */
    await expect(
      uploadOwnedAsset({
        identity,
        file: bytesFile([0xff, 0xfe, 0xfd], 'broken.txt', 'text/plain'),
        scope: 'space',
      }),
    ).resolves.toBeDefined();
  });

  it('0字节文件返回invalid_upload', async () => {
    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile([], 'note.pdf', 'application/pdf'),
      scope: 'space',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'invalid_upload',
      status: 400,
    });
  });

  it('持久化失败时会清理已落地对象', async () => {
    drizzleRepo.createUploadedPending.mockRejectedValue(new Error('db down'));

    const promise = uploadOwnedAsset({
      identity,
      file: bytesFile(
        [0x25, 0x50, 0x44, 0x46, 0x2d],
        'note.pdf',
        'application/pdf',
      ),
      scope: 'space',
    });

    await expect(promise).rejects.toThrow('db down');
    expect(removeStoredAsset).toHaveBeenCalledWith({
      storageKey: 'assets/a',
      absolutePath: '/tmp/assets/a',
    });
  });
});
