import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WebAppContent } from '@educanvas/canvas-protocol';
import { WebAppArtifactView } from './web-app-artifact-view';

vi.mock('./persistent-web-runtime', () => ({
  PersistentWebRuntime: (props: Record<string, unknown>) => (
    <div
      data-testid="persistent-web-runtime"
      data-runtime-props={JSON.stringify(props)}
    >
      正在启动隔离运行环境
    </div>
  ),
}));

function makeWebAppContent(
  overrides: Partial<WebAppContent> = {},
): WebAppContent {
  return {
    schemaVersion: 1,
    manifest: {
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          mediaType: 'text/html',
          content: '<h1>标题</h1>',
          hash: 'e'.repeat(64),
        },
        {
          path: 'main.css',
          mediaType: 'text/css',
          content: 'body {color:#000;}',
          hash: 'f'.repeat(64),
        },
      ],
    },
    lockedDependencies: [],
    capabilities: ['javascript-runtime', 'css-render'],
    budget: {
      maxInputBytes: 2048,
      maxMessageBytes: 1024,
      maxOutputBytes: 2048,
      maxDurationMs: 10000,
      maxConcurrentInstances: 1,
      maxQueueDepth: 2,
      maxMessagesPerSecond: 20,
    },
    diagnostics: [{ code: 'build_succeeded' }],
    generatedByModel: true,
    ...overrides,
  };
}

function render(viewProps: Parameters<typeof WebAppArtifactView>[0]) {
  return renderToStaticMarkup(<WebAppArtifactView {...viewProps} />);
}

describe('WebAppArtifactView（三面板 UI）', () => {
  it('预览 tab 在 Canvas 模式启动 PersistentWebRuntime', () => {
    const html = render({
      artifactId: 'art-1',
      artifactVersionId: 'v1',
      content: makeWebAppContent(),
      presentation: 'canvas',
    });
    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-testid="persistent-web-runtime"');
    expect(html).toContain('正在启动隔离运行环境');
  });

  it('源码/构建 tab 仅读展示', () => {
    const html = render({
      artifactId: 'art-1',
      artifactVersionId: 'v1',
      content: makeWebAppContent(),
      presentation: 'canvas',
    });
    expect(html).toContain('源码');
    expect(html).toContain('构建');
    expect(html).toContain('javascript-runtime');
    expect(html).toContain('无锁定依赖');
    expect(html).toContain('eeeeeeee');
  });

  it('live-preview 面板不启动运行时并显示说明', () => {
    const html = render({
      artifactId: 'art-1',
      artifactVersionId: 'v1',
      content: makeWebAppContent(),
      presentation: 'live-preview',
    });
    expect(html).toContain('交互网页需在 Canvas 打开');
    expect(html).not.toContain('data-testid="persistent-web-runtime"');
  });

  it('源码内容按文本渲染，不执行 raw HTML', () => {
    const html = render({
      artifactId: 'art-1',
      artifactVersionId: 'v1',
      content: makeWebAppContent({
        manifest: {
          entry: 'index.html',
          files: [
            {
              path: 'index.html',
              mediaType: 'text/html',
              content: '<img src="x" onerror="alert(1)" />',
              hash: '1'.repeat(64),
            },
          ],
        },
      }),
      presentation: 'canvas',
    });
    expect(html).toContain(
      '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot; /&gt;',
    );
    expect(html).not.toContain('<img src="x" onerror="alert(1)" />');
  });

  it('Runtime 只收到 Artifact 与不可变版本身份，不接收 manifest 或私密字段', () => {
    const html = render({
      artifactId: 'art-bound',
      artifactVersionId: 'version-bound',
      content: makeWebAppContent({
        manifest: {
          entry: 'index.html',
          files: [
            {
              path: 'index.html',
              mediaType: 'text/html',
              content: 'PRIVATE_SOURCE_SENTINEL',
              hash: '1'.repeat(64),
            },
          ],
        },
      }),
      presentation: 'canvas',
    });

    expect(html).toContain('&quot;artifactId&quot;:&quot;art-bound&quot;');
    expect(html).toContain(
      '&quot;artifactVersionId&quot;:&quot;version-bound&quot;',
    );
    const runtimeProps = html.match(/data-runtime-props="([^"]+)"/)?.[1];
    expect(runtimeProps).toBeDefined();
    expect(runtimeProps).not.toContain('PRIVATE_SOURCE_SENTINEL');
    expect(runtimeProps).not.toContain('manifest');
    expect(runtimeProps).not.toContain('prompt');
    expect(runtimeProps).not.toContain('provider');
    expect(runtimeProps).not.toContain('objectKey');
  });
});
