import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeArtifactResource } from './canvas-resource-fixtures';
import {
  createArtifact,
  deleteArtifact,
  fetchArtifactDetail,
  saveMarkdownDocumentArtifact,
  restoreArtifactVersion,
  reviseArtifact,
  saveNoteArtifact,
} from './artifact-client';
import { pollArtifactUntilSettled } from './artifact-polling-client';

const artifact = {
  id: '10000000-0000-4000-8000-000000000001',
  kind: 'note',
  trustTier: 'tier1',
  title: '课堂笔记',
  status: 'active',
  latestVersion: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('artifact client mutation contracts', () => {
  it('手动创建与保存接受明确的 null job', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ artifact, job: null }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ artifact, job: null }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createArtifact('note', '课堂笔记', [], '# 初始内容'),
    ).resolves.toEqual({ artifact, job: null });
    await expect(saveNoteArtifact(artifact.id, 1, '# 修改后')).resolves.toEqual(
      { artifact, job: null },
    );

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({
      action: 'save_note',
      baseVersion: 1,
      markdown: '# 修改后',
    });
  });

  it('支持创建 markdown_document 产物而不带额外字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifact: { ...artifact, kind: 'markdown_document' },
          job: { id: 'job-md-1', status: 'queued' },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createArtifact('markdown_document', '课程文档'),
    ).resolves.toMatchObject({
      artifact: { ...artifact, kind: 'markdown_document' },
      job: { id: 'job-md-1' },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      kind: 'markdown_document',
      title: '课程文档',
    });
  });

  it('支持创建 web_app 产物', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifact: { ...artifact, kind: 'web_app', trustTier: 'tier2' },
          job: { id: 'job-web-1', status: 'queued' },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createArtifact('web_app', '课程网页')).resolves.toMatchObject({
      artifact: { ...artifact, kind: 'web_app', trustTier: 'tier2' },
      job: { id: 'job-web-1' },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      kind: 'web_app',
      title: '课程网页',
    });
  });

  it('AI 修改使用 generate 动作并要求任务标识', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifact: { ...artifact, status: 'proposed' },
          job: { id: '20000000-0000-4000-8000-000000000002' },
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await reviseArtifact(artifact.id, 2, '补充例题');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      action: 'generate',
      baseVersion: 2,
      instruction: '补充例题',
    });
  });

  it('Markdown 文档直接保存为新版本且返回 null job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifact: {
            ...artifact,
            kind: 'markdown_document',
            latestVersion: 3,
          },
          job: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      saveMarkdownDocumentArtifact(artifact.id, 2, '# 新文档版本'),
    ).resolves.toEqual({
      artifact: { ...artifact, kind: 'markdown_document', latestVersion: 3 },
      job: null,
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      action: 'save_markdown_document',
      baseVersion: 2,
      markdown: '# 新文档版本',
    });
  });

  it('恢复历史版本走 restore 动作并返回新版本响应', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifact: { ...artifact, status: 'active', latestVersion: 3 },
          job: { id: '20000000-0000-4000-8000-000000000002' },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(restoreArtifactVersion(artifact.id, 1, 2)).resolves.toEqual({
      artifact: { ...artifact, status: 'active', latestVersion: 3 },
      job: { id: '20000000-0000-4000-8000-000000000002' },
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      action: 'restore',
      sourceVersion: 1,
      expectedLatestVersion: 2,
    });
  });

  it('图像详情只接受安全媒体投影，不需要Prompt或对象键', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            artifact: {
              ...artifact,
              kind: 'generated_image',
              trustTier: 'tier2',
              latestVersion: 1,
              fromConversation: true,
              createdAt: '2026-07-27T00:00:00.000Z',
              updatedAt: '2026-07-27T00:01:00.000Z',
            },
            version: {
              id: '50000000-0000-4000-8000-000000000001',
              version: 1,
              content: null,
              media: {
                url: `/api/v1/chat/artifacts/${artifact.id}/image`,
                contentVersion: 1,
                contentType: 'image/png',
                byteSize: 4,
                size: '1024x1024',
                image: {
                  provider: 'fixture',
                  resolvedModelId: 'image-v1',
                  latencyMs: 10,
                },
              },
            },
            versions: [
              {
                version: 1,
                generatedBy: 'model:image.generate:canvas-image-v1',
                revisionInstruction: null,
                createdAt: '2026-07-27T00:01:00.000Z',
              },
            ],
            latestJob: {
              id: '20000000-0000-4000-8000-000000000002',
              status: 'succeeded',
              progress: 100,
              failureCode: null,
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const detail = await fetchArtifactDetail(artifact.id);

    expect(detail.version?.media?.contentType).toBe('image/png');
    expect(detail.version?.media).not.toHaveProperty('prompt');
    expect(detail.version?.media).not.toHaveProperty('objectKey');
  });

  it('从完整 CanvasResource 投影中只读取浏览器需要的操作权限', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            artifact: {
              ...artifact,
              fromConversation: true,
              createdAt: '2026-07-27T00:00:00.000Z',
              updatedAt: '2026-07-27T00:01:00.000Z',
            },
            version: {
              id: '50000000-0000-4000-8000-000000000002',
              version: 2,
              content: { contentVersion: 1, markdown: '# 课堂笔记' },
              media: null,
            },
            versions: [
              {
                version: 2,
                generatedBy: 'manual:note',
                revisionInstruction: null,
                createdAt: '2026-07-27T00:01:00.000Z',
              },
            ],
            latestJob: null,
            canvasResource: makeArtifactResource('mind_map', {
              notebookId: '30000000-0000-4000-8000-000000000003',
              allowedActions: ['view', 'download', 'delete'],
            }),
          }),
          { status: 200 },
        ),
      ),
    );

    const detail = await fetchArtifactDetail(artifact.id);

    // R06 收口：client 保留服务端完整 CanvasResource（schema 验证后原样保留），
    // 不再按 artifact.kind 重建协议事实。
    expect(detail.canvasResource?.allowedActions).toEqual([
      'view',
      'download',
      'delete',
    ]);
    expect(detail.canvasResource?.notebookId).toBe(
      '30000000-0000-4000-8000-000000000003',
    );
  });

  it('删除产物依赖浏览器同源凭据且不伪造 Origin 头', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteArtifact(artifact.id)).resolves.toEqual({
      deleted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/chat/artifacts/${artifact.id}`,
      { method: 'DELETE' },
    );
  });

  it('轮询可在超时后返回 timed_out 状态', async () => {
    vi.useFakeTimers();
    const runningDetail = {
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        trustTier: artifact.trustTier,
        title: artifact.title,
        status: 'active',
        latestVersion: 0,
        fromConversation: false,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:01:00.000Z',
      },
      version: null,
      versions: [],
      latestJob: {
        id: '30000000-0000-4000-8000-000000000001',
        status: 'running',
        progress: 3,
        failureCode: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(runningDetail), { status: 200 }),
        ),
      ),
    );

    const pollResult = pollArtifactUntilSettled(
      '30000000-0000-4000-8000-000000000001',
      {
        intervalMs: 5,
        timeoutMs: 20,
      },
    );
    await vi.advanceTimersByTimeAsync(30);
    const result = await pollResult;
    expect(result.outcome).toBe('timed_out');
    expect(result.detail.latestJob?.status).toBe('running');
    vi.useRealTimers();
  });

  it('轮询识别服务端 canceled 状态', async () => {
    const cancelledDetail = {
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        trustTier: artifact.trustTier,
        title: artifact.title,
        status: 'active',
        latestVersion: 0,
        fromConversation: false,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:01:00.000Z',
      },
      version: null,
      versions: [],
      latestJob: {
        id: '30000000-0000-4000-8000-000000000002',
        status: 'cancelled',
        progress: 100,
        failureCode: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(cancelledDetail), { status: 200 }),
        ),
      ),
    );

    const result = await pollArtifactUntilSettled(
      '30000000-0000-4000-8000-000000000002',
      { timeoutMs: 100 },
    );
    expect(result).toMatchObject({
      outcome: 'cancelled',
      detail: { latestJob: { status: 'cancelled' } },
    });
  });

  it('区分本地停止观察与服务端 cancelled 事实', async () => {
    const runningDetail = {
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        trustTier: artifact.trustTier,
        title: artifact.title,
        status: 'active',
        latestVersion: 0,
        fromConversation: false,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:01:00.000Z',
      },
      version: null,
      versions: [],
      latestJob: {
        id: '30000000-0000-4000-8000-000000000003',
        status: 'running',
        progress: 5,
        failureCode: null,
      },
    };
    const abortController = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(runningDetail), { status: 200 }),
        )
        .mockImplementation(async (_url, options: RequestInit | undefined) => {
          if (options?.signal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          return new Response(JSON.stringify(runningDetail), { status: 200 });
        }),
    );

    const resultPromise = pollArtifactUntilSettled(
      '30000000-0000-4000-8000-000000000003',
      {
        intervalMs: 5,
        timeoutMs: 100,
        signal: abortController.signal,
      },
    );
    abortController.abort();
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
