import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import { fetchArtifactDetail } from './artifact-client';
import { makeArtifactResource } from './canvas-resource-fixtures';

const SERVER_RESOURCE: CanvasResource = makeArtifactResource('mind_map', {
  notebookId: 'nb-server-42',
  allowedActions: ['view', 'download'],
  provenance: {
    origin: 'agent_generated',
    createdBy: 'agent',
    createdAt: '2026-08-01T00:00:00+08:00',
    sourceResourceIds: ['src-1'],
    operationId: 'op-1',
    generator: null,
  },
});

function serverJson(resource: unknown) {
  return {
    artifact: {
      id: '22222222-2222-4222-8222-222222222222',
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '测试产物',
      status: 'active',
      latestVersion: 1,
      fromConversation: true,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
    version: {
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      content: {
        contentVersion: 1,
        root: { id: 'root', label: '根节点' },
      },
      media: null,
    },
    versions: [],
    latestJob: null,
    canvasResource: resource,
  };
}

function mockDetailResponse(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Artifact CanvasResource 服务端权威保真（R06/#306 收口）', () => {
  it('notebookId 经 client parser 后保持不变', async () => {
    mockDetailResponse(serverJson(SERVER_RESOURCE));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource?.notebookId).toBe('nb-server-42');
  });

  it('renderer.rendererId 保持不变', async () => {
    mockDetailResponse(serverJson(SERVER_RESOURCE));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource?.renderer.rendererId).toBe(
      'artifact.mind-map',
    );
    expect(detail.canvasResource?.renderer.rendererVersion).toBe(1);
  });

  it('representation 保持不变', async () => {
    mockDetailResponse(serverJson(SERVER_RESOURCE));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource?.representation.kind).toBe('structured');
    expect(detail.canvasResource?.representation.mimeType).toBe(
      'application/vnd.educanvas.mind-map+json',
    );
  });

  it('provenance 保持不变', async () => {
    mockDetailResponse(serverJson(SERVER_RESOURCE));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource?.provenance.operationId).toBe('op-1');
    expect(detail.canvasResource?.provenance.sourceResourceIds).toEqual([
      'src-1',
    ]);
  });

  it('runtime 保持不变', async () => {
    mockDetailResponse(serverJson(SERVER_RESOURCE));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource?.runtime).toEqual({ kind: 'none' });
  });

  it('allowedActions 保持不变', async () => {
    mockDetailResponse(serverJson(SERVER_RESOURCE));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource?.allowedActions).toEqual(['view', 'download']);
  });

  it('未产生 version 时服务端不返回 canvasResource，client 不伪造', async () => {
    // 服务端无 resource 时省略字段（`...(canvasResource ? { canvasResource } : {})`），非 null
    mockDetailResponse(serverJson(undefined));
    const detail = await fetchArtifactDetail('art-1');
    expect(detail.canvasResource).toBeUndefined();
    // 浏览器端不得出现任何 fake notebookId / fake renderer：
    // artifact-canvas-resource.ts（UNKNOWN_NOTEBOOK_ID 等）已删除。
  });

  it('未知/非法服务器协议 fail closed：client 拒绝而非自行修补', async () => {
    mockDetailResponse(
      serverJson({
        schemaVersion: 1,
        resourceId: 'art-1',
        notebookId: 'nb-1',
        resourceKind: 'artifact',
        title: '缺字段的非法资源',
        // 缺少 renderer/representation/runtime/status 等必填字段
      }),
    );
    await expect(fetchArtifactDetail('art-1')).rejects.toThrow(
      '产物详情响应格式不正确。',
    );
  });
});
