import { renderToStaticMarkup } from 'react-dom/server';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let states: unknown[] = [];
  let effects: Array<() => void | (() => void)> = [];

  return {
    reset() {
      cursor = 0;
      states = [];
      effects = [];
    },
    beginRender() {
      cursor = 0;
      effects = [];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) {
        states[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [
        states[index],
        (next: unknown) => {
          states[index] =
            typeof next === 'function'
              ? (next as (value: unknown) => unknown)(states[index])
              : next;
        },
      ];
    },
    useEffect(effect: () => void | (() => void)) {
      effects.push(effect);
    },
    runEffect() {
      const effect = effects.at(-1);
      if (!effect) throw new Error('expected a captured effect');
      return effect();
    },
  };
});

const mocks = vi.hoisted(() => ({
  fetchArtifactDetail: vi.fn(),
  fetchCanvasResource: vi.fn(),
  isShellRenderedArtifactResource: vi.fn(),
  selectWebCanvasResourceRenderer: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: hooks.useEffect,
    useState: hooks.useState,
  };
});

vi.mock('@/features/canvas/artifact-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/canvas/artifact-client')>();
  return { ...actual, fetchArtifactDetail: mocks.fetchArtifactDetail };
});

vi.mock('@/features/canvas/canvas-resource-client', () => ({
  fetchCanvasResource: mocks.fetchCanvasResource,
}));

vi.mock('@/features/canvas/artifact-shell-rendering', () => ({
  isShellRenderedArtifactResource: mocks.isShellRenderedArtifactResource,
}));

vi.mock('@/features/canvas/web-canvas-resource-registry', () => ({
  selectWebCanvasResourceRenderer: mocks.selectWebCanvasResourceRenderer,
}));

vi.mock('@/features/canvas/persistent-web-runtime', () => ({
  PersistentWebRuntime: () => <div data-persistent-runtime />,
}));

import {
  LiveVoiceResourcePreview,
  type LiveVoicePreviewTarget,
} from './live-voice-resource-preview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function resource(
  resourceKind: 'source' | 'artifact',
  title: string,
): CanvasResource {
  return {
    resourceKind,
    title,
    renderer: { rendererId: 'test.renderer' },
  } as CanvasResource;
}

function artifactDetail(kind: 'note' | 'dom_exploration') {
  return {
    artifact: {
      id: 'artifact-1',
      kind,
      trustTier: 'tier1',
      title: '测试产物',
      status: 'active',
      latestVersion: 1,
      fromConversation: true,
      createdAt: '2026-08-12T00:00:00Z',
      updatedAt: '2026-08-12T00:00:00Z',
    },
    version: { id: 'version-1', version: 1, content: {}, media: null },
    versions: [],
    latestJob: null,
  };
}

const sourceTarget: LiveVoicePreviewTarget = {
  kind: 'source',
  id: 'source-a',
  title: '资料 A',
};

function renderPreview(
  target: LiveVoicePreviewTarget = sourceTarget,
  scopeKey = 'notebook-a',
  onClose = vi.fn(),
) {
  hooks.beginRender();
  return LiveVoiceResourcePreview({ target, scopeKey, onClose });
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('LiveVoiceResourcePreview', () => {
  beforeEach(() => {
    hooks.reset();
    vi.clearAllMocks();
    mocks.isShellRenderedArtifactResource.mockReturnValue(false);
    mocks.selectWebCanvasResourceRenderer.mockReturnValue({
      kind: 'available',
      Renderer: ({ resource: selected }: { resource: CanvasResource }) => (
        <div data-selected-resource>{selected.title}</div>
      ),
    });
  });

  it('Artifact 必须先通过 CanvasResource gate，才读取详情', async () => {
    const gate = deferred<CanvasResource>();
    mocks.fetchCanvasResource.mockReturnValueOnce(gate.promise);
    mocks.fetchArtifactDetail.mockResolvedValueOnce(artifactDetail('note'));
    mocks.isShellRenderedArtifactResource.mockReturnValue(true);

    renderPreview({ kind: 'artifact', id: 'artifact-1', title: '笔记' });
    hooks.runEffect();
    expect(mocks.fetchCanvasResource).toHaveBeenCalledWith(
      'artifact',
      'artifact-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.fetchArtifactDetail).not.toHaveBeenCalled();

    gate.resolve(resource('artifact', '笔记'));
    await flushPromises();

    expect(mocks.fetchArtifactDetail).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCanvasResource.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchArtifactDetail.mock.invocationCallOrder[0]!,
    );
  });

  it('非 shell Artifact 缺少兼容 Renderer 时 fail closed，不读取详情', async () => {
    mocks.fetchCanvasResource.mockResolvedValueOnce(
      resource('artifact', '不支持的产物'),
    );
    mocks.selectWebCanvasResourceRenderer.mockReturnValueOnce({
      kind: 'unavailable',
      reason: 'renderer_not_registered',
    });

    renderPreview({
      kind: 'artifact',
      id: 'artifact-unsupported',
      title: '不支持的产物',
    });
    hooks.runEffect();
    await flushPromises();

    expect(mocks.fetchArtifactDetail).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(
      renderPreview({
        kind: 'artifact',
        id: 'artifact-unsupported',
        title: '不支持的产物',
      }),
    );
    expect(html).toContain('没有兼容的安全渲染器');
    expect(html).not.toContain('data-persistent-runtime');
  });

  it('dom_exploration 在 live-preview 中不启动持久 Runtime', async () => {
    mocks.fetchCanvasResource.mockResolvedValueOnce(
      resource('artifact', '交互网页'),
    );
    mocks.fetchArtifactDetail.mockResolvedValueOnce(
      artifactDetail('dom_exploration'),
    );
    mocks.isShellRenderedArtifactResource.mockReturnValue(true);

    renderPreview({
      kind: 'artifact',
      id: 'artifact-1',
      title: '交互网页',
    });
    hooks.runEffect();
    await flushPromises();

    const html = renderToStaticMarkup(
      renderPreview({
        kind: 'artifact',
        id: 'artifact-1',
        title: '交互网页',
      }),
    );
    expect(html).toContain('交互网页需在 Canvas 打开');
    expect(html).not.toContain('data-persistent-runtime');
  });

  it.each([
    {
      name: 'scope',
      firstTarget: sourceTarget,
      firstScope: 'notebook-a',
      secondTarget: sourceTarget,
      secondScope: 'notebook-b',
    },
    {
      name: 'target',
      firstTarget: sourceTarget,
      firstScope: 'notebook-a',
      secondTarget: {
        kind: 'source' as const,
        id: 'source-b',
        title: '资料 B',
      },
      secondScope: 'notebook-a',
    },
  ])(
    '$name 改变会 abort 旧请求，迟到响应不能覆盖新资源',
    async ({ firstScope, firstTarget, secondScope, secondTarget }) => {
      const first = deferred<CanvasResource>();
      const second = deferred<CanvasResource>();
      mocks.fetchCanvasResource
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      renderPreview(firstTarget, firstScope);
      const cleanup = hooks.runEffect();
      const firstSignal = mocks.fetchCanvasResource.mock.calls[0]?.[2]
        ?.signal as AbortSignal;

      cleanup?.();
      renderPreview(secondTarget, secondScope);
      hooks.runEffect();
      expect(firstSignal.aborted).toBe(true);

      second.resolve(resource('source', '新资源'));
      await flushPromises();
      first.resolve(resource('source', '旧资源'));
      await flushPromises();

      const html = renderToStaticMarkup(
        renderPreview(secondTarget, secondScope),
      );
      expect(html).toContain('新资源');
      expect(html).not.toContain('旧资源');
    },
  );

  it('forbidden 是不可重试终态', async () => {
    mocks.fetchCanvasResource.mockRejectedValueOnce({
      kind: 'forbidden',
      message: '没有权限访问这个资源。',
    });

    renderPreview();
    hooks.runEffect();
    await flushPromises();

    const html = renderToStaticMarkup(renderPreview());
    expect(html).toContain('无权访问');
    expect(html).not.toContain('>重试<');
  });

  it('资源加载失败只落到预览错误态，不触发 Live 退出回调', async () => {
    const onClose = vi.fn();
    mocks.fetchCanvasResource.mockRejectedValueOnce({
      kind: 'failed',
      message: '预览服务暂时不可用。',
    });

    renderPreview(sourceTarget, 'notebook-a', onClose);
    hooks.runEffect();
    await flushPromises();

    const html = renderToStaticMarkup(
      renderPreview(sourceTarget, 'notebook-a', onClose),
    );
    expect(html).toContain('预览服务暂时不可用');
    expect(html).toContain('>重试<');
    expect(onClose).not.toHaveBeenCalled();
  });
});
