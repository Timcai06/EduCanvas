import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotebookRequestScopeProvider,
  useNotebookRequestScope,
} from './notebook-request-scope';
import { notebookScopedUrl } from './notebook-request-context';
import { useTeachingTurn } from '@/features/chat/use-teaching-turn';

const a = {
  notebookId: '11111111-1111-4111-8111-111111111111',
  conversationId: '33333333-3333-4333-8333-333333333333',
};
const b = {
  notebookId: '22222222-2222-4222-8222-222222222222',
  conversationId: '44444444-4444-4444-8444-444444444444',
};
afterEach(() => vi.unstubAllGlobals());

function NativeResource() {
  const context = useNotebookRequestScope();
  return (
    <a
      href={notebookScopedUrl(
        '/api/v1/chat/assets/asset/file?download=1',
        context,
      )}
    >
      下载
    </a>
  );
}

describe('explicit teaching workspace request scope', () => {
  it('keeps independent page trees and native downloads in their server-restored Notebook', () => {
    const first = renderToStaticMarkup(
      <NotebookRequestScopeProvider value={a}>
        <NativeResource />
      </NotebookRequestScopeProvider>,
    );
    const second = renderToStaticMarkup(
      <NotebookRequestScopeProvider value={b}>
        <NativeResource />
      </NotebookRequestScopeProvider>,
    );
    expect(first).toContain(`requestNotebookId=${a.notebookId}`);
    expect(first).toContain(`requestConversationId=${a.conversationId}`);
    expect(first).not.toContain(b.notebookId);
    expect(second).toContain(`requestNotebookId=${b.notebookId}`);
    expect(
      renderToStaticMarkup(
        <NotebookRequestScopeProvider value={null}>
          <NativeResource />
        </NotebookRequestScopeProvider>,
      ),
    ).not.toContain('requestNotebookId');
  });

  it('sends normal teaching chat to page A after another tab changes the shared cursor', async () => {
    let turn!: ReturnType<typeof useTeachingTurn>;
    function TeachingPage() {
      // The SSR probe captures the real transport handler for a subsequent scoped request.
      // eslint-disable-next-line react-hooks/globals
      turn = useTeachingTurn([], a.notebookId, a.conversationId);
      return null;
    }
    renderToStaticMarkup(<TeachingPage />);
    vi.stubGlobal('window', {
      location: { pathname: `/notebook/${b.notebookId}/learn` },
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await turn.send('解释这一章');
    const sent = new URL(fetch.mock.calls[0]![0], 'https://app.test');
    expect(sent.pathname).toBe('/api/v1/learn/turn');
    expect(sent.searchParams.get('requestNotebookId')).toBe(a.notebookId);
    expect(sent.searchParams.get('requestConversationId')).toBe(
      a.conversationId,
    );
  });
});
