import { describe, expect, it, vi } from 'vitest';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import { telegramCanvasSummaries } from './canvas-delivery';

/**
 * canvas 投影摘要测试：关注两件事
 * 1) artifactId 去重后只加载一次
 * 2) 投影阶段异常不阻断主文本响应
 */
const eventBase = {
  protocol: 'gateway.v1' as const,
  eventId: 'event:1',
  operationId: 'operation:1',
  sequence: 0,
  occurredAt: '2026-08-04T00:00:00.000Z',
};

const resource = {
  schemaVersion: 1 as const,
  resourceId: 'artifact:1',
  notebookId: 'notebook:1',
  resourceKind: 'artifact' as const,
  title: '图像产物',
  status: 'ready' as const,
  version: { versionId: 'version:1', sequence: 1, checksum: null },
  representation: {
    kind: 'image' as const,
    mimeType: 'image/png',
    byteSize: null,
  },
  renderer: {
    rendererId: 'artifact.generated-image',
    rendererVersion: 1,
  },
  trustTier: 'tier2' as const,
  allowedActions: ['view' as const],
  canProduceCandidateLearningEvents: false,
  provenance: {
    origin: 'agent_generated' as const,
    createdBy: 'agent' as const,
    createdAt: '2026-08-04T00:00:00.000Z',
    sourceResourceIds: [],
    operationId: null,
    generator: null,
  },
  runtime: { kind: 'none' as const },
};

describe('telegramCanvasSummaries', () => {
  it('deduplicates artifact events and loads through trusted binding context', async () => {
    const events: GatewayOperationEvent[] = [
      {
        ...eventBase,
        type: 'artifact.proposed',
        artifactId: 'artifact:1',
        artifactKind: 'generated_image',
        title: '图像产物',
      },
      {
        ...eventBase,
        eventId: 'event:2',
        sequence: 1,
        type: 'artifact.version_added',
        artifactId: 'artifact:1',
        versionId: 'version:1',
      },
    ];
    const loader = vi.fn(async () => resource);
    const summaries = await telegramCanvasSummaries(
      events,
      { userId: 'user:1', notebookId: 'notebook:1' },
      loader,
    );
    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith({
      userId: 'user:1',
      notebookId: 'notebook:1',
      artifactId: 'artifact:1',
    });
    expect(summaries).toEqual([
      '▣ 图像产物\n资源已就绪；请在 EduCanvas Web 中安全查看或下载。',
    ]);
  });

  it('suppresses repository failures and does not affect text delivery', async () => {
    const summaries = await telegramCanvasSummaries(
      [
        {
          ...eventBase,
          type: 'artifact.failed',
          artifactId: 'artifact:private',
          jobId: null,
          code: 'RUNTIME_FAILED',
        },
      ],
      { userId: 'user:1', notebookId: 'notebook:1' },
      async () => {
        throw new Error('private database path');
      },
    );
    expect(summaries).toEqual([]);
  });
});
