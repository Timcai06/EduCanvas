import {
  extractReadableHtml,
  fetchPublicWebScript,
  type FetchedWebScript,
} from '@educanvas/asset-processing';
import { nodeWebPageConnector } from '@educanvas/asset-processing/node';
import { chromium } from 'playwright';

const MAX_SCRIPT_COUNT = 12;
const MAX_TOTAL_SCRIPT_BYTES = 2 * 1024 * 1024;

export type WebRenderFailureCode =
  | 'link_render_unavailable'
  | 'link_render_failed'
  | 'link_no_extractable_content';

export class WebRenderError extends Error {
  override readonly name = 'WebRenderError';

  constructor(
    readonly code: WebRenderFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

/**
 * Worker-only JS rendering fallback for the already stored HTML snapshot. The browser is kept
 * fully offline: this closes the time-of-check/time-of-use DNS-rebinding window and ensures the
 * derived text always belongs to the immutable version captured by the import request.
 */
export async function renderReadableStoredHtml(
  html: string,
  baseUrl?: string,
  fetchScript: (url: string) => Promise<FetchedWebScript> = (url) =>
    fetchPublicWebScript(url, { connector: nodeWebPageConnector }),
): Promise<string> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (cause) {
    throw new WebRenderError('link_render_unavailable', { cause });
  }
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      javaScriptEnabled: true,
    });
    const page = await context.newPage();
    let scriptCount = 0;
    let totalScriptBytes = 0;
    await page.route('**/*', async (route) => {
      if (
        route.request().resourceType() !== 'script' ||
        scriptCount >= MAX_SCRIPT_COUNT
      ) {
        await route.abort('blockedbyclient');
        return;
      }
      scriptCount += 1;
      try {
        const script = await fetchScript(route.request().url());
        totalScriptBytes += script.bytes.byteLength;
        if (totalScriptBytes > MAX_TOTAL_SCRIPT_BYTES) {
          await route.abort('blockedbyclient');
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: script.contentType,
          body: Buffer.from(script.bytes),
        });
      } catch {
        await route.abort('blockedbyclient');
      }
    });
    const storedHtml = baseUrl ? withTrustedBaseUrl(html, baseUrl) : html;
    await page.setContent(storedHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page.waitForTimeout(1_000);
    const text = extractReadableHtml(await page.content()).text;
    if ([...text].length < 80) {
      throw new WebRenderError('link_no_extractable_content');
    }
    await context.close();
    return text;
  } catch (cause) {
    if (cause instanceof WebRenderError) {
      throw cause;
    }
    throw new WebRenderError('link_render_failed', { cause });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function withTrustedBaseUrl(html: string, baseUrl: string): string {
  const escaped = baseUrl.replace(
    /[&"<>]/gu,
    (character) =>
      ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character]!,
  );
  const withoutUntrustedBase = html.replace(/<base(?:\s[^>]*)?>/giu, '');
  const base = `<base href="${escaped}">`;
  return /<head(?:\s[^>]*)?>/iu.test(withoutUntrustedBase)
    ? withoutUntrustedBase.replace(
        /<head(?:\s[^>]*)?>/iu,
        (head) => `${head}${base}`,
      )
    : `${base}${withoutUntrustedBase}`;
}
