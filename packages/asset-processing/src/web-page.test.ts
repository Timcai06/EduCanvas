import { describe, expect, it, vi } from 'vitest';
import {
  WebPageError,
  extractReadableHtml,
  fetchPublicWebScript,
  fetchWebPage,
  isFakeIpAddress,
  isPublicIpAddress,
  type WebPageConnector,
} from './web-page';

function connectorFor(
  request: (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => Promise<Response>,
): WebPageConnector {
  return async (url, init, approvedAddresses) => ({
    response: await request(url, init),
    connectedAddress: approvedAddresses[0]!,
  });
}

describe('web page processing', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '10.0.0.1',
    '::1',
    'fc00::1',
    'fec0::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('classifies non-public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it('extracts bounded readable content and metadata from HTML', () => {
    const page = extractReadableHtml(`<!doctype html><html><head>
      <title>  Photosynthesis progress </title><style>.x{display:none}</style>
      </head><body><nav>menu</nav><main><h1>Progress</h1>
      <p>Plants convert light energy into chemical energy.</p>
      <p>Recent work improves artificial photosynthesis catalysts.</p></main>
      <script>window.secret = 'ignore me'</script></body></html>`);

    expect(page.title).toBe('Photosynthesis progress');
    expect(page.text).toContain('Plants convert light energy');
    expect(page.text).not.toContain('window.secret');
    expect(page.summary).toContain('Plants convert light energy');
  });

  it('rejects private hosts before issuing a request', async () => {
    const request = vi.fn();
    await expect(
      fetchWebPage('http://internal.example/private', {
        request,
        resolveHostname: async () => ['127.0.0.1'],
      }),
    ).rejects.toMatchObject({ code: 'link_blocked_host' });
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed for DNS hostnames without a binding connector', async () => {
    const request = vi.fn(
      async () =>
        new Response('<html><body>unbound</body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    );
    await expect(
      fetchWebPage('https://public.example', {
        request,
        resolveHostname: async () => ['93.184.216.34'],
      }),
    ).rejects.toMatchObject({ code: 'link_network_unreachable' });
    expect(request).not.toHaveBeenCalled();
  });

  it('validates every redirect target and blocks redirects to private hosts', async () => {
    const request = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        }),
    );
    await expect(
      fetchWebPage('https://public.example/start', {
        request,
        connector: connectorFor(request),
        resolveHostname: async () => ['93.184.216.34'],
      }),
    ).rejects.toMatchObject({ code: 'link_blocked_host' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('enforces the streaming byte limit even without content-length', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(6));
              controller.enqueue(new Uint8Array(6));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/html' } },
        ),
    );
    await expect(
      fetchWebPage('https://public.example', {
        request,
        connector: connectorFor(request),
        resolveHostname: async () => ['93.184.216.34'],
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'link_page_too_large' });
  });

  it('cancels a response rejected by the declared page byte budget', async () => {
    const cancel = vi.fn();
    const request = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: {
            'content-type': 'text/html',
            'content-length': '11',
          },
        }),
    );
    await expect(
      fetchWebPage('https://public.example', {
        request,
        connector: connectorFor(request),
        resolveHostname: async () => ['93.184.216.34'],
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'link_page_too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('classifies access walls and unsupported formats with stable codes', async () => {
    const resolveHostname = async () => ['93.184.216.34'];
    await expect(
      fetchWebPage('https://public.example', {
        resolveHostname,
        request: async () => new Response(null, { status: 403 }),
        connector: connectorFor(
          async () => new Response(null, { status: 403 }),
        ),
      }),
    ).rejects.toEqual(new WebPageError('link_access_blocked'));
    await expect(
      fetchWebPage('https://public.example', {
        resolveHostname,
        request: async () =>
          new Response('binary', {
            headers: { 'content-type': 'application/octet-stream' },
          }),
        connector: connectorFor(
          async () =>
            new Response('binary', {
              headers: { 'content-type': 'application/octet-stream' },
            }),
        ),
      }),
    ).rejects.toMatchObject({ code: 'link_unsupported_format' });
  });

  it('can retain a JS-only shell for the asynchronous Worker fallback', async () => {
    const html =
      '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    const page = await fetchWebPage('https://public.example/app', {
      resolveHostname: async () => ['93.184.216.34'],
      request: async () =>
        new Response(html, { headers: { 'content-type': 'text/html' } }),
      connector: connectorFor(
        async () =>
          new Response(html, { headers: { 'content-type': 'text/html' } }),
      ),
      allowEmptyText: true,
    });

    expect(page.title).toBeNull();
    expect(page.text).toBe('');
    expect(new TextDecoder().decode(page.bytes)).toContain('id="root"');
  });

  it('fetches a bounded public script and validates its redirect targets', async () => {
    const resolveHostname = async () => ['93.184.216.34'];
    await expect(
      fetchPublicWebScript('https://cdn.example/app.js', {
        resolveHostname,
        request: async () =>
          new Response('document.body.textContent = "rendered"', {
            headers: { 'content-type': 'application/javascript' },
          }),
        connector: connectorFor(
          async () =>
            new Response('document.body.textContent = "rendered"', {
              headers: { 'content-type': 'application/javascript' },
            }),
        ),
      }),
    ).resolves.toMatchObject({
      finalUrl: 'https://cdn.example/app.js',
      contentType: 'application/javascript',
    });

    await expect(
      fetchPublicWebScript('https://cdn.example/app.js', {
        resolveHostname,
        request: async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1/private.js' },
          }),
        connector: connectorFor(
          async () =>
            new Response(null, {
              status: 302,
              headers: { location: 'http://127.0.0.1/private.js' },
            }),
        ),
      }),
    ).rejects.toMatchObject({ code: 'link_blocked_host' });
  });

  describe('isFakeIpAddress', () => {
    it.each([
      ['198.18.0.1', true],
      ['198.18.0.0', true],
      ['198.19.255.254', true],
      ['198.19.0.1', true],
      ['198.17.255.255', false],
      ['198.20.0.1', false],
      ['10.0.0.1', false],
      ['127.0.0.1', false],
      ['93.184.216.34', false],
    ])('classifies %s as Fake-IP = %s', (address, expected) => {
      expect(isFakeIpAddress(address)).toBe(expected);
    });
  });

  describe('Fake-IP DNS detection', () => {
    it('throws fake_ip_dns_detected when all DNS answers are in 198.18.0.0/15', async () => {
      const request = vi.fn();
      await expect(
        fetchWebPage('https://example.com', {
          request,
          resolveHostname: async () => ['198.19.2.3', '198.18.0.1'],
        }),
      ).rejects.toMatchObject({ code: 'fake_ip_dns_detected' });
      expect(request).not.toHaveBeenCalled();
    });

    it('throws link_blocked_host when DNS answers mix Fake-IP with private addresses', async () => {
      const request = vi.fn();
      await expect(
        fetchWebPage('https://example.com', {
          request,
          resolveHostname: async () => ['198.19.2.3', '10.0.0.1'],
        }),
      ).rejects.toMatchObject({ code: 'link_blocked_host' });
      expect(request).not.toHaveBeenCalled();
    });

    it('throws link_blocked_host when DNS answers mix Fake-IP with public addresses', async () => {
      const request = vi.fn();
      await expect(
        fetchWebPage('https://example.com', {
          request,
          resolveHostname: async () => ['198.19.2.3', '93.184.216.34'],
        }),
      ).rejects.toMatchObject({ code: 'link_blocked_host' });
      expect(request).not.toHaveBeenCalled();
    });

    it('still throws link_blocked_host for non-Fake-IP private addresses', async () => {
      const request = vi.fn();
      for (const bad of [
        '127.0.0.1',
        '10.0.0.1',
        '172.16.0.1',
        '192.168.1.1',
      ]) {
        await expect(
          fetchWebPage('https://example.com', {
            request,
            resolveHostname: async () => [bad],
          }),
        ).rejects.toMatchObject({ code: 'link_blocked_host' });
      }
      expect(request).not.toHaveBeenCalled();
    });

    it('rejects redirects to Fake-IP targets via domain resolution', async () => {
      const request = vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://redirected.example/admin' },
          }),
      );
      await expect(
        fetchWebPage('https://public.example/start', {
          request,
          connector: connectorFor(request),
          resolveHostname: async (hostname) =>
            hostname === 'public.example' ? ['93.184.216.34'] : ['198.19.5.6'],
        }),
      ).rejects.toMatchObject({ code: 'fake_ip_dns_detected' });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('throws link_blocked_host for direct IP literal in 198.18.0.0/15', async () => {
      const request = vi.fn();
      await expect(
        fetchWebPage('http://198.19.5.6/admin', {
          request,
        }),
      ).rejects.toMatchObject({ code: 'link_blocked_host' });
      expect(request).not.toHaveBeenCalled();
    });

    it('throws link_blocked_host when redirecting to IP literal in 198.18.0.0/15', async () => {
      const request = vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://198.19.5.6/admin' },
          }),
      );
      await expect(
        fetchWebPage('https://public.example/start', {
          request,
          connector: connectorFor(request),
          resolveHostname: async () => ['93.184.216.34'],
        }),
      ).rejects.toMatchObject({ code: 'link_blocked_host' });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('allows all-public DNS answers', async () => {
      const request = vi.fn(
        async () =>
          new Response('<html><title>OK</title><body>hi</body></html>', {
            headers: { 'content-type': 'text/html' },
          }),
      );
      await expect(
        fetchWebPage('https://public.example', {
          request,
          connector: connectorFor(request),
          resolveHostname: async () => ['93.184.216.34', '93.184.216.35'],
        }),
      ).resolves.toMatchObject({
        requestedUrl: 'https://public.example/',
        finalUrl: 'https://public.example/',
      });
    });
  });

  it('combines external cancellation with the request timeout', async () => {
    const controller = new AbortController();
    const request = vi.fn(
      (_input: string | URL | globalThis.Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () =>
              reject(
                init.signal?.reason ??
                  new DOMException('aborted', 'AbortError'),
              ),
            { once: true },
          );
          controller.abort(new Error('cancelled by caller'));
        }),
    );
    await expect(
      fetchWebPage('https://public.example', {
        connector: connectorFor(request),
        resolveHostname: async () => ['93.184.216.34'],
        signal: controller.signal,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'link_network_unreachable' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the connector reports an unreviewed peer address', async () => {
    const connector: WebPageConnector = async () => ({
      response: new Response('<html><body>private</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
      connectedAddress: '10.0.0.1',
    });
    await expect(
      fetchWebPage('https://public.example', {
        connector,
        resolveHostname: async () => ['93.184.216.34'],
      }),
    ).rejects.toMatchObject({ code: 'link_blocked_host' });
  });

  it('accepts an IPv4-mapped peer only when it matches the reviewed IPv4', async () => {
    const connector: WebPageConnector = async () => ({
      response: new Response('<html><body>public</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
      connectedAddress: '::ffff:5db8:d822',
    });
    await expect(
      fetchWebPage('https://public.example', {
        connector,
        resolveHostname: async () => ['93.184.216.34'],
      }),
    ).resolves.toMatchObject({ finalUrl: 'https://public.example/' });
  });
});
