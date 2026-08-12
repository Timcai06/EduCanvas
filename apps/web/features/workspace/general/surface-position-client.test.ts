import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSurfacePositions,
  parseSurfacePositionPage,
  saveSurfacePosition,
  SurfacePositionClientError,
} from './surface-position-client';

function position(index: number) {
  return {
    resourceKind: 'source' as const,
    resourceId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    zone: 'periphery' as const,
    x: 0.8,
    y: 0.2,
    z: 0,
    restState: 'folded' as const,
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('surface position response', () => {
  it('兼容旧端点一次返回超过 256 条的位置', () => {
    const positions = Array.from({ length: 300 }, (_, index) =>
      position(index),
    );
    expect(parseSurfacePositionPage({ positions }).positions).toHaveLength(300);
  });

  it('兼容分页响应并保持无逐资源详情请求', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            positions: [position(1), position(2)],
            page: { nextCursor: 'page-2' },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            positions: [position(2), position(3)],
            page: { nextCursor: null },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSurfacePositions()).resolves.toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/canvas/surface-layout');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/v1/canvas/surface-layout?cursor=page-2',
    );
  });

  it('重复 cursor 和未知字段 fail closed 为稳定可观察错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            positions: [],
            page: { nextCursor: 'same' },
          }),
        ),
      ),
    );
    await expect(fetchSurfacePositions()).rejects.toEqual(
      expect.objectContaining<Partial<SurfacePositionClientError>>({
        code: 'surface_layout_response_invalid',
      }),
    );
    expect(() =>
      parseSurfacePositionPage({ positions: [], secret: 'x' }),
    ).toThrow(SurfacePositionClientError);
  });

  it('加载与保存失败只暴露稳定错误码', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error('private network detail'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSurfacePositions()).rejects.toMatchObject({
      code: 'surface_layout_load_failed',
    });
    const source = position(1);
    const saveInput = {
      resourceKind: source.resourceKind,
      resourceId: source.resourceId,
      zone: source.zone,
      x: source.x,
      y: source.y,
      z: source.z,
      restState: source.restState,
    };
    await expect(saveSurfacePosition(saveInput)).rejects.toMatchObject({
      code: 'surface_layout_save_failed',
    });
  });
});
