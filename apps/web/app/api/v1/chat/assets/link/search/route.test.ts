import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  conversation: vi.fn(),
  trustedOrigin: vi.fn(),
  resolvePipeline: vi.fn(),
  search: vi.fn(),
  trafficAcquire: vi.fn(),
  release: vi.fn(),
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
  resolveSearchCandidatePipeline: mocks.resolvePipeline,
}));
vi.mock('@/server/assets/link-traffic-limiter', () => ({
  linkTrafficKey: (subject: string, notebook: string) =>
    `${subject}:${notebook}`,
  linkTrafficLimiter: { acquire: mocks.trafficAcquire },
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
    mocks.resolvePipeline.mockReturnValue({ search: mocks.search });
    mocks.trafficAcquire.mockReturnValue({
      allowed: true,
      release: mocks.release,
    });
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
          accessibility: 'accessible',
          contentKind: 'article',
        },
      ],
      attemptedProviders: ['private-provider-name'],
    });

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(200);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      results: [
        {
          title: 'Research article',
          url: 'https://example.com/research',
          domain: 'example.com',
          snippet: 'A concise abstract.',
          accessibility: 'accessible',
          imported: false,
        },
      ],
    });
  });

  it('keeps browser discovery available when Fake-IP DNS blocks preflight', async () => {
    mocks.search.mockResolvedValue({
      results: [],
      uncheckedResults: [
        {
          title: 'Research article',
          url: 'https://example.com/research',
          sourceDomain: 'example.com',
          snippet: 'A concise abstract.',
          accessibility: 'unchecked',
        },
      ],
      failures: [
        {
          url: 'https://example.com/research',
          domain: 'example.com',
          code: 'candidate_fake_ip_dns_detected',
          retryable: false,
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
    expect(mocks.release).toHaveBeenCalledTimes(1);
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
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'search_provider_unavailable',
      },
    });
  });

  it('reports missing configuration as non-retryable', async () => {
    mocks.resolvePipeline.mockReturnValue(null);

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'search_not_configured' },
    });
  });

  it('shares a stable 429 response when the actor and Notebook budget is full', async () => {
    mocks.trafficAcquire.mockReturnValue({
      allowed: false,
      reason: 'concurrency',
      retryAfterMs: 1_000,
    });

    const response = await POST(request({ query: 'research topic' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({
      error: {
        code: 'search_rate_limited',
      },
    });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('maps unknown provider failures to a stable public error', async () => {
    mocks.search.mockRejectedValue(new Error('secret provider body'));

    const response = await POST(request({ query: 'research topic' }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: {
        code: 'search_provider_unavailable',
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret provider body');
  });
});
