import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notebookScopedFetch,
  notebookScopedUrl,
  readNotebookRequestContext,
  scopeNotebookResourceUrls,
} from './notebook-request-context';
import { loadAssetPreview } from '@/features/assets/asset-client';

const a = {
  notebookId: '11111111-1111-4111-8111-111111111111',
  conversationId: '33333333-3333-4333-8333-333333333333',
};
const b = {
  notebookId: '22222222-2222-4222-8222-222222222222',
  conversationId: '44444444-4444-4444-8444-444444444444',
};
const tab = (context: typeof a) =>
  vi.stubGlobal('window', {
    location: {
      pathname: `/notebook/${context.notebookId}/conversation/${context.conversationId}`,
    },
  });
afterEach(() => vi.unstubAllGlobals());

describe('Notebook browser request context', () => {
  it.each([
    '/api/v1/chat/turn',
    '/api/v1/chat/turn/turn/events?after=7',
    '/api/v1/chat/turn/turn/cancel',
    '/api/v1/chat/assets',
    '/api/v1/chat/assets/asset/file?download=1',
    '/api/v1/chat/assets/link/search',
    '/api/v1/chat/artifacts/artifact/image',
    '/api/v1/chat/artifacts/artifact/audio',
    '/api/v1/chat/artifacts/artifact/download?version=2',
    '/api/v1/chat/artifacts/artifact/picturebook/pages/0',
    '/api/v1/canvas/resources',
    '/api/v1/canvas/surface-layout',
    '/api/v1/canvas/runtime/runs',
    '/api/v1/canvas/runtime/runs/run/terminal',
    '/api/v1/canvas/runtime/requests/request/cancel',
    '/api/v1/assistant/turn',
  ])('scopes fetch and native URLs for %s', (path) => {
    tab(a);
    const url = new URL(notebookScopedUrl(path), 'https://app.test');
    expect(url.searchParams.get('requestNotebookId')).toBe(a.notebookId);
    expect(url.searchParams.get('requestConversationId')).toBe(
      a.conversationId,
    );
    expect(url.pathname).toBe(new URL(path, 'https://app.test').pathname);
  });

  it('reads the local tab each time and preserves a frozen in-flight scope after navigation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    tab(a);
    const frozen = readNotebookRequestContext();
    await notebookScopedFetch('/api/v1/chat/assets');
    tab(b);
    await notebookScopedFetch('/api/v1/chat/assets');
    await notebookScopedFetch(
      '/api/v1/chat/turn/turn/cancel',
      { method: 'POST' },
      frozen,
    );
    expect(
      fetch.mock.calls.map(([url]) =>
        new URL(url, 'https://app.test').searchParams.get('requestNotebookId'),
      ),
    ).toEqual([a.notebookId, b.notebookId, a.notebookId]);
  });

  it('does not add context to external, unrelated, legacy or already frozen URLs', () => {
    tab(a);
    for (const url of [
      'https://other.test/api/v1/chat/assets',
      '//other.test/api/v1/chat/assets',
      '/api/v1/learn/setup',
      '/api/v1/notebooks/any/plans',
      '/api/v1/chat/assets?requestNotebookId=malformed',
    ])
      expect(notebookScopedUrl(url)).toBe(url);
    vi.stubGlobal('window', { location: { pathname: '/' } });
    expect(notebookScopedUrl('/api/v1/chat/assets')).toBe(
      '/api/v1/chat/assets',
    );
  });

  it('retains malformed path context so the server can reject it', () => {
    vi.stubGlobal('window', {
      location: { pathname: '/notebook/bad/conversation/wrong' },
    });
    expect(
      new URL(
        notebookScopedUrl('/api/v1/chat/assets'),
        'https://app.test',
      ).searchParams.get('requestNotebookId'),
    ).toBe('bad');
  });

  it('freezes native file URLs and Markdown derived images when the response arrives after navigation', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    tab(a);
    const preview = loadAssetPreview('asset');
    tab(b);
    resolve(
      new Response(
        JSON.stringify({
          preview: {
            kind: 'pdf',
            fileName: 'lesson.pdf',
            mimeType: 'application/pdf',
            fileUrl: '/api/v1/chat/assets/asset/file',
            representation: {
              quality: 'structured',
              markdown:
                '![图](/api/v1/chat/assets/asset/resources/images/1.png)',
            },
          },
        }),
        { status: 200 },
      ),
    );
    const result = await preview;
    expect(result.kind).toBe('pdf');
    if (result.kind !== 'pdf') throw new Error('unexpected preview');
    expect(
      new URL(result.fileUrl, 'https://app.test').searchParams.get(
        'requestNotebookId',
      ),
    ).toBe(a.notebookId);
    expect(result.representation?.markdown).toContain(
      `requestNotebookId=${a.notebookId}`,
    );
    const once = scopeNotebookResourceUrls(result, a);
    expect(scopeNotebookResourceUrls(once, b)).toEqual(once);
  });
});
