import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCanvasResource,
  type CanvasResourceClientError,
} from './canvas-resource-client';

function makeValidResource(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resourceId: 'aaaa0000-0000-4000-8000-000000000001',
    notebookId: 'bbbb0000-0000-4000-8000-000000000001',
    resourceKind: 'source',
    title: '测试来源',
    status: 'ready',
    version: {
      versionId: 'cccc0000-0000-4000-8000-000000000001',
      sequence: 1,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 1024,
    },
    renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-27T00:00:00+08:00',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCanvasResource', () => {
  it('Source 成功返回校验后的 CanvasResource', async () => {
    const resource = makeValidResource();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ resource })),
    );

    const result = await fetchCanvasResource('source', resource.resourceId);

    expect(result.resourceId).toBe(resource.resourceId);
    expect(result.resourceKind).toBe('source');
    expect(result.renderer.rendererId).toBe('source.pdf');
  });

  it('Artifact 成功返回校验后的 CanvasResource', async () => {
    const resource = makeValidResource({
      resourceKind: 'artifact',
      renderer: { rendererId: 'artifact.mind-map', rendererVersion: 1 },
      representation: {
        kind: 'structured',
        mimeType: 'application/json',
        byteSize: null,
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ resource })),
    );

    const result = await fetchCanvasResource('artifact', resource.resourceId);

    expect(result.resourceKind).toBe('artifact');
    expect(result.renderer.rendererId).toBe('artifact.mind-map');
  });

  it('非法协议响应返回 unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ resource: { invalid: true } })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('401 返回 forbidden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('403 返回 forbidden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('404 返回 not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('422 返回 failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unprocessable', { status: 422 })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'failed' });
  });

  it('503 返回 unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('AbortError 原样交给调用方处理，不误报为错误', async () => {
    const abortError = new DOMException(
      'The operation was aborted.',
      'AbortError',
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toBe(abortError);
  });

  it('URL 编码正确处理特殊字符 resourceKind 和 resourceId', async () => {
    const resource = makeValidResource();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ resource }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/api/v1/canvas/resources/source/');
    expect(calledUrl).not.toContain(' ');
  });

  it('响应不含 resource 字段返回 unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ notResource: true })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('不泄露原始错误内容：错误消息仅包含稳定文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('internal stack trace here', { status: 500 }),
        ),
    );

    try {
      await fetchCanvasResource(
        'source',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );
      expect.fail('should have thrown');
    } catch (error) {
      const clientError = error as CanvasResourceClientError;
      expect(clientError.kind).toBe('failed');
      expect(clientError.message).not.toContain('stack');
      expect(clientError.message).not.toContain('internal');
      expect(clientError.message).not.toContain('storageKey');
      expect(clientError.message).not.toContain('objectKey');
    }
  });

  it('非 JSON 响应返回 failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'failed' });
  });

  it('网络错误返回 offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await expect(
      fetchCanvasResource('source', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ kind: 'offline' });
  });

  it('传入 AbortSignal 并在 fetch 中使用', async () => {
    const resource = makeValidResource();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ resource }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    await fetchCanvasResource('source', resource.resourceId, {
      signal: controller.signal,
    });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it('cache 设为 no-store', async () => {
    const resource = makeValidResource();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ resource }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchCanvasResource('source', resource.resourceId);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ cache: 'no-store' });
  });
});
