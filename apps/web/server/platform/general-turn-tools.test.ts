import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentTool } from '@educanvas/agent-runtime';
import type { WebOperationArtifacts } from './general-artifact-tool';
import type { WebOperationImageArtifacts } from './general-image-tool';

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

const { WebOperationSources, createGeneralToolKernel } =
  await import('./general-turn-tools');

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
  let createdOrdinal = 0;

  beforeEach(() => {
    mocks.persistAsset.mockReset();
    mocks.createSource.mockReset();
    mocks.persistAsset.mockImplementation(async ({ page: value }) => ({
      descriptor: { assetId: `asset-${new URL(value.url).pathname.slice(1)}` },
      version: { versionId: `version-${new URL(value.url).pathname.slice(1)}` },
    }));
    createdOrdinal = 0;
    mocks.createSource.mockImplementation(async (input) => ({
      ...input,
      id: `source-${createdOrdinal + 1}`,
      kind: 'web',
      ordinal: ++createdOrdinal,
    }));
  });

  it('resolves markers against normalized final fetch URLs and this operation only', async () => {
    const sources = new WebOperationSources({
      identity,
      conversationId: 'conversation-1',
      spaceId: 'notebook-1',
      operationId: 'operation-current',
      maximumSources: 8,
    });
    const redirected = {
      ...page(0),
      requestedUrl: 'https://redirect.example/start',
      url: 'https://example.com/final#section',
    };

    await expect(sources.persist(redirected)).resolves.toEqual({
      citationMarker: 1,
    });
    await expect(
      sources.persist({
        ...redirected,
        url: 'https://example.com/final#other',
      }),
    ).resolves.toEqual({ citationMarker: 1 });
    expect(sources.hasPersistedCitation('https://example.com/final', 1)).toBe(
      true,
    );
    expect(
      sources.hasPersistedCitation('https://example.com/final#other', 1),
    ).toBe(true);
    expect(
      sources.hasPersistedCitation('https://redirect.example/start', 1),
    ).toBe(false);
    expect(sources.hasPersistedCitation('https://example.com/final', 2)).toBe(
      false,
    );

    const otherOperation = new WebOperationSources({
      identity,
      conversationId: 'conversation-1',
      spaceId: 'notebook-1',
      operationId: 'operation-other',
      initialSources: [
        {
          id: 'source-foreign',
          operationId: 'operation-current',
          kind: 'web',
          ordinal: 1,
          assetId: 'asset-1',
          assetVersionId: 'version-1',
          label: 'Source',
          url: 'https://example.com/final',
        },
      ],
    });
    expect(
      otherOperation.hasPersistedCitation('https://example.com/final', 1),
    ).toBe(false);
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

function tool(name: string): AgentTool<{ value: string }, { result: string }> {
  return {
    name,
    description: `Test ${name} tool`,
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    timeoutMs: 1_000,
    handler: async () => ({ result: 'ok' }),
  };
}

describe('General turn artifact status tool mode', () => {
  it('offers proposals in auto, writes only for explicit output, and no artifact tools in research', () => {
    const createTool = vi.fn(() => tool('createCanvasArtifact'));
    const getStatusTool = vi.fn(() => tool('getCanvasArtifactStatus'));
    const requestConfirmationTool = vi.fn(() => tool('proposeCanvasArtifact'));
    const artifacts = {
      createTool,
      getStatusTool,
      requestConfirmationTool,
    } as unknown as WebOperationArtifacts;
    const sources = {
      trafficKey: 'test-traffic-key',
      persist: vi.fn(),
    } as unknown as Parameters<typeof createGeneralToolKernel>[0];
    const images = {
      createTool: () => tool('generateCanvasImage'),
    } as unknown as WebOperationImageArtifacts;

    const ordinary = createGeneralToolKernel(sources, artifacts, images, {
      deepResearch: false,
      allowArtifactConfirmation: true,
    });
    expect(ordinary.staticCapabilities).toContain('artifact.read');
    expect(ordinary.staticCapabilities).toContain(
      'artifact.confirmation.propose',
    );
    expect(ordinary.staticCapabilities).not.toContain('artifact.create');
    expect(getStatusTool).toHaveBeenCalledTimes(1);
    expect(requestConfirmationTool).toHaveBeenCalledTimes(1);
    expect(createTool).not.toHaveBeenCalled();

    const explicitOutput = createGeneralToolKernel(sources, artifacts, images, {
      deepResearch: false,
      allowArtifactWrites: true,
    });
    expect(explicitOutput.staticCapabilities).toContain('artifact.create');
    expect(explicitOutput.staticCapabilities).toContain('artifact.read');
    expect(explicitOutput.staticCapabilities).not.toContain(
      'artifact.confirmation.propose',
    );
    expect(createTool).toHaveBeenCalledOnce();

    getStatusTool.mockClear();
    requestConfirmationTool.mockClear();
    const research = createGeneralToolKernel(sources, artifacts, images, {
      deepResearch: true,
    });
    expect(research.staticCapabilities).not.toContain('artifact.read');
    expect(research.staticCapabilities).not.toContain('artifact.create');
    expect(research.staticCapabilities).not.toContain(
      'artifact.confirmation.propose',
    );
    expect(getStatusTool).not.toHaveBeenCalled();
    expect(requestConfirmationTool).not.toHaveBeenCalled();
  });
});
