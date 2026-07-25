import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createArtifact,
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
});
