import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  conversation: vi.fn(),
  trustedOrigin: vi.fn(),
  resolveService: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.identity,
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: mocks.conversation,
}));
vi.mock('@/server/http/request-security', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/http/request-security')>();
  return { ...original, isTrustedSameOriginWrite: mocks.trustedOrigin };
});
vi.mock('@/server/tools/web-search', () => ({
  resolveSearchService: mocks.resolveService,
}));

import { SearchServiceError } from '@/server/tools/search-service';
import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/v1/chat/assets/link/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/chat/assets/link/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.identity.mockResolvedValue({ studentId: 'student-1' });
    mocks.conversation.mockResolvedValue({ spaceId: 'space-1' });
    mocks.resolveService.mockReturnValue({ search: mocks.search });
  });

  it('returns only the browser-safe Provider-neutral projection', async () => {
    mocks.search.mockResolvedValue({
      results: [
        {
          title: 'Research article',
          url: 'https://example.com/research',
          sourceDomain: 'example.com',
          snippet: 'A concise abstract.',
          score: 0.98,
          publishedAt: '2026-08-20',
        },
      ],
      attemptedProviders: ['private-provider-name'],
    });

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          title: 'Research article',
          url: 'https://example.com/research',
          domain: 'example.com',
          snippet: 'A concise abstract.',
          accessibility: 'unchecked',
          imported: false,
        },
      ],
    });
  });

  it('rejects untrusted writes before invoking search', async () => {
    mocks.trustedOrigin.mockReturnValue(false);

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(403);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('uses a stable retryable error without exposing provider details', async () => {
    mocks.search.mockRejectedValue(
      new SearchServiceError('search_provider_unavailable', true),
    );

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'search_provider_unavailable',
        message: '网页搜索暂时不可用。请稍后重试。',
        retryable: true,
      },
    });
  });

  it('reports missing configuration as non-retryable', async () => {
    mocks.resolveService.mockReturnValue(null);

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'search_not_configured', retryable: false },
    });
  });
});
