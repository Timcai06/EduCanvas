import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  persistAsset: vi.fn(),
  createSource: vi.fn(),
}));

vi.mock('../assets/asset-upload', () => ({
  persistFetchedWebPageAsset: mocks.persistAsset,
}));

vi.mock('./general-turn-persistence', () => ({
  webGeneralSources: { createOrGetWebSource: mocks.createSource },
}));

const { WebOperationSources } = await import('./general-turn-tools');

const identity = { token: '', studentId: 'actor-1' };
const page = (index: number) => ({
  requestedUrl: `https://example.com/${index}`,
  url: `https://example.com/${index}`,
  title: `Source ${index}`,
  text: '正文',
  bytes: new TextEncoder().encode('<html><body>正文</body></html>'),
  contentType: 'text/html',
  fetchedAt: new Date('2026-08-17T00:00:00.000Z'),
});

describe('WebOperationSources research budget', () => {
  beforeEach(() => {
    mocks.persistAsset.mockReset();
    mocks.createSource.mockReset();
    mocks.persistAsset.mockImplementation(async ({ page: value }) => ({
      descriptor: { assetId: `asset-${new URL(value.url).pathname.slice(1)}` },
      version: { versionId: `version-${new URL(value.url).pathname.slice(1)}` },
    }));
    mocks.createSource.mockImplementation(
      async ({ url }, ordinal?: number) => ({
        ordinal: ordinal ?? Number(new URL(url).pathname.slice(1)) + 1,
      }),
    );
  });

  it('最多持久化 8 个不同网页，重复 URL 复用同一来源', async () => {
    let ordinal = 0;
    mocks.createSource.mockImplementation(async () => ({ ordinal: ++ordinal }));
    const sources = new WebOperationSources({
      identity,
      conversationId: 'conversation-1',
      spaceId: 'notebook-1',
      operationId: 'operation-1',
      maximumSources: 8,
    });

    for (let index = 0; index < 8; index += 1) {
      await expect(sources.persist(page(index))).resolves.toEqual({
        citationMarker: index + 1,
      });
    }
    await expect(sources.persist(page(0))).resolves.toEqual({
      citationMarker: 1,
    });
    await expect(sources.persist(page(8))).rejects.toThrow(
      'web_source_budget_exceeded',
    );
    expect(mocks.persistAsset).toHaveBeenCalledTimes(8);
  });

  it('并发读取同一 URL 只创建一个 Asset 和来源', async () => {
    const sources = new WebOperationSources({
      identity,
      conversationId: 'conversation-1',
      spaceId: 'notebook-1',
      operationId: 'operation-1',
      maximumSources: 8,
    });

    await expect(
      Promise.all([sources.persist(page(0)), sources.persist(page(0))]),
    ).resolves.toEqual([{ citationMarker: 1 }, { citationMarker: 1 }]);
    expect(mocks.persistAsset).toHaveBeenCalledTimes(1);
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
  });

  it('深度研究来源以受控 origin 持久化', async () => {
    const sources = new WebOperationSources({
      identity,
      conversationId: 'conversation-1',
      spaceId: 'notebook-1',
      operationId: 'operation-1',
      researchSource: true,
    });

    await sources.persist(page(0));

    expect(mocks.persistAsset).toHaveBeenCalledWith(
      expect.objectContaining({ researchSource: true }),
    );
  });
});
