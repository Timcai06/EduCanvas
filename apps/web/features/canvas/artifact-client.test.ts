import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createArtifact,
  deleteArtifact,
  fetchArtifactDetail,
  reviseArtifact,
  saveNoteArtifact,
} from './artifact-client';

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
});
