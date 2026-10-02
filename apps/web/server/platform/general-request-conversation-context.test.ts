import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  legacy: vi.fn(),
  legacySubject: vi.fn(),
  owned: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./general-conversation', () => ({
  loadOwnedGeneralConversation: mocks.legacy,
  loadOwnedGeneralConversationForSubject: mocks.legacySubject,
}));
vi.mock('@educanvas/db', () => ({
  DrizzlePlatformConversationRepository: class {
    getOwned = mocks.owned;
  },
}));

import {
  forwardGeneralRequestContext,
  loadOwnedGeneralRequestConversation,
  loadOwnedGeneralRequestConversationForSubject,
  loadOwnedNotebookResourceRequestConversation,
} from './general-request-conversation-context';

const notebookA = '11111111-1111-4111-8111-111111111111';
const notebookB = '22222222-2222-4222-8222-222222222222';
const conversationA = '33333333-3333-4333-8333-333333333333';
const conversationB = '44444444-4444-4444-8444-444444444444';
const identity = { studentId: 'anon:trusted', token: 'trusted' };
const a = { id: conversationA, spaceId: notebookA, agentProfileId: 'general' };
const b = { id: conversationB, spaceId: notebookB, agentProfileId: 'general' };
const request = (query: string) =>
  new Request(`https://app.test/api/v1/chat/artifacts${query}`);
const scope = (notebookId: string, conversationId: string) =>
  `?requestNotebookId=${notebookId}&requestConversationId=${conversationId}`;

describe('first-party request Conversation scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.legacy.mockResolvedValue(b);
    mocks.owned.mockResolvedValue(a);
  });

  it('keeps tab A in A after tab B overwrites the shared active Cookie', async () => {
    mocks.owned.mockImplementation(async ({ conversationId }) =>
      conversationId === conversationA ? a : b,
    );
    expect(
      await loadOwnedGeneralRequestConversation(
        identity,
        request(scope(notebookA, conversationA)),
      ),
    ).toEqual(a);
    expect(
      await loadOwnedGeneralRequestConversation(
        identity,
        request(scope(notebookB, conversationB)),
      ),
    ).toEqual(b);
    expect(mocks.owned).toHaveBeenCalledWith({
      conversationId: conversationA,
      trustedSubjectId: identity.studentId,
    });
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it.each([
    '?requestNotebookId=invalid&requestConversationId=invalid',
    `?requestNotebookId=${notebookA}`,
    `?requestConversationId=${conversationA}`,
    `?requestNotebookId=${notebookA}&requestNotebookId=${notebookA}&requestConversationId=${conversationA}`,
    `?requestNotebookId=${notebookA}&requestConversationId=${conversationA}&requestConversationId=${conversationA}`,
    '?requestNotebookId=&requestConversationId=',
  ])(
    'rejects malformed or ambiguous explicit context before database access: %s',
    async (query) => {
      expect(
        await loadOwnedGeneralRequestConversation(identity, request(query)),
      ).toBeNull();
      expect(mocks.owned).not.toHaveBeenCalled();
      expect(mocks.legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...a, agentProfileId: 'teaching' },
    { ...a, spaceId: notebookB },
  ])(
    'rejects unavailable, other-profile and cross-Notebook Conversations without fallback',
    async (owned) => {
      mocks.owned.mockResolvedValue(owned);
      expect(
        await loadOwnedGeneralRequestConversation(
          identity,
          request(scope(notebookA, conversationA)),
        ),
      ).toBeNull();
      expect(mocks.legacy).not.toHaveBeenCalled();
    },
  );

  it('preserves anonymous legacy requests and the trusted effective-subject entrypoint', async () => {
    expect(
      await loadOwnedGeneralRequestConversation(identity, request('')),
    ).toEqual(b);
    expect(mocks.legacy).toHaveBeenCalledWith(identity);
    mocks.legacySubject.mockResolvedValue(b);
    expect(
      await loadOwnedGeneralRequestConversationForSubject(
        identity.studentId,
        request(''),
      ),
    ).toEqual(b);
    expect(mocks.legacySubject).toHaveBeenCalledWith(identity.studentId);
  });

  it('allows the authenticated old course to read its own Notebook resources while keeping general runtime strict', async () => {
    mocks.owned.mockResolvedValue({ ...a, agentProfileId: 'k12.teacher' });
    expect(
      await loadOwnedNotebookResourceRequestConversation(
        identity,
        request(scope(notebookA, conversationA)),
      ),
    ).toEqual({ ...a, agentProfileId: 'k12.teacher' });
    expect(
      await loadOwnedGeneralRequestConversation(
        identity,
        request(scope(notebookA, conversationA)),
      ),
    ).toBeNull();
    mocks.owned.mockResolvedValue({
      ...a,
      agentProfileId: 'untrusted.profile',
    });
    expect(
      await loadOwnedNotebookResourceRequestConversation(
        identity,
        request(scope(notebookA, conversationA)),
      ),
    ).toBeNull();
    mocks.owned.mockResolvedValue({
      ...a,
      agentProfileId: 'k12.teacher',
      spaceId: notebookB,
    });
    expect(
      await loadOwnedNotebookResourceRequestConversation(
        identity,
        request(scope(notebookA, conversationA)),
      ),
    ).toBeNull();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it('carries explicit scope into BFF internal requests', () => {
    const forwarded = new URL(
      forwardGeneralRequestContext(
        '/api/v1/chat/artifacts?version=2',
        request(scope(notebookA, conversationA)),
      ),
    );
    expect(forwarded.searchParams.get('requestNotebookId')).toBe(notebookA);
    expect(forwarded.searchParams.get('requestConversationId')).toBe(
      conversationA,
    );
    expect(forwarded.searchParams.get('version')).toBe('2');
  });
});
