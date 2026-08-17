import { describe, expect, it, vi } from 'vitest';
import {
  WebPageError,
  extractReadableHtml,
  fetchPublicWebScript,
  fetchWebPage,
  isPublicIpAddress,
} from './web-page';

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
        resolveHostname: async () => ['93.184.216.34'],
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'link_page_too_large' });
  });

  it('classifies access walls and unsupported formats with stable codes', async () => {
    const resolveHostname = async () => ['93.184.216.34'];
    await expect(
      fetchWebPage('https://public.example', {
        resolveHostname,
        request: async () => new Response(null, { status: 403 }),
      }),
    ).rejects.toEqual(new WebPageError('link_access_blocked'));
    await expect(
      fetchWebPage('https://public.example', {
        resolveHostname,
        request: async () =>
          new Response('binary', {
            headers: { 'content-type': 'application/octet-stream' },
          }),
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
      }),
    ).rejects.toMatchObject({ code: 'link_blocked_host' });
  });
});
