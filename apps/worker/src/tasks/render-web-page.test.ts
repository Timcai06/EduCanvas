import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  launch: vi.fn(),
  setContent: vi.fn(),
  content: vi.fn(),
  route: vi.fn(),
  closeBrowser: vi.fn(),
  closeContext: vi.fn(),
  waitForTimeout: vi.fn(),
  routeHandler: undefined as
    ((route: ReturnType<typeof fakeRoute>) => Promise<void>) | undefined,
}));

vi.mock('playwright', () => ({ chromium: { launch: browserMocks.launch } }));

function fakeRoute(url: string, resourceType = 'script') {
  return {
    request: () => ({ url: () => url, resourceType: () => resourceType }),
    abort: vi.fn().mockResolvedValue(undefined),
    fulfill: vi.fn().mockResolvedValue(undefined),
  };
}

import { renderReadableStoredHtml } from './render-web-page';

describe('stored HTML browser fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.routeHandler = undefined;
    browserMocks.closeBrowser.mockResolvedValue(undefined);
    browserMocks.closeContext.mockResolvedValue(undefined);
    browserMocks.waitForTimeout.mockResolvedValue(undefined);
    browserMocks.content.mockResolvedValue(
      `<main>${'rendered article content '.repeat(10)}</main>`,
    );
    browserMocks.route.mockImplementation(
      async (_pattern: string, handler: typeof browserMocks.routeHandler) => {
        browserMocks.routeHandler = handler;
      },
    );
    browserMocks.launch.mockResolvedValue({
      newContext: async () => ({
        newPage: async () => ({
          route: browserMocks.route,
          setContent: browserMocks.setContent,
          waitForTimeout: browserMocks.waitForTimeout,
          content: browserMocks.content,
        }),
        close: browserMocks.closeContext,
      }),
      close: browserMocks.closeBrowser,
    });
  });

  it('injects the trusted base and fulfills only the external script', async () => {
    const scriptRoute = fakeRoute('https://public.example/app.js');
    const imageRoute = fakeRoute('https://public.example/image.png', 'image');
    browserMocks.setContent.mockImplementation(async (html: string) => {
      expect(html).toContain('<base href="https://public.example/article">');
      await browserMocks.routeHandler!(scriptRoute);
      await browserMocks.routeHandler!(imageRoute);
    });
    const fetchScript = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: 'application/javascript',
      bytes: new TextEncoder().encode('document.body.textContent="ready"'),
    }));

    await renderReadableStoredHtml(
      '<html><head><base href="https://attacker.invalid/"></head><body><script src="/app.js"></script></body></html>',
      'https://public.example/article',
      fetchScript,
    );

    expect(fetchScript).toHaveBeenCalledWith('https://public.example/app.js');
    expect(scriptRoute.fulfill).toHaveBeenCalledOnce();
    expect(imageRoute.abort).toHaveBeenCalledOnce();
  });

  it('caps script count and cumulative fulfilled bytes', async () => {
    const routes = Array.from({ length: 13 }, (_, index) =>
      fakeRoute(`https://cdn.example/${index}.js`),
    );
    browserMocks.setContent.mockImplementation(async () => {
      for (const route of routes) await browserMocks.routeHandler!(route);
    });
    const fetchScript = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: 'application/javascript',
      bytes: new Uint8Array(200_000),
    }));

    await renderReadableStoredHtml(
      '<html><body><script src="/app.js"></script></body></html>',
      'https://public.example/article',
      fetchScript,
    );

    expect(fetchScript).toHaveBeenCalledTimes(12);
    expect(routes[9]!.fulfill).toHaveBeenCalledOnce();
    expect(routes[10]!.abort).toHaveBeenCalledOnce();
    expect(routes[11]!.abort).toHaveBeenCalledOnce();
    expect(routes[12]!.abort).toHaveBeenCalledOnce();
  });
});
