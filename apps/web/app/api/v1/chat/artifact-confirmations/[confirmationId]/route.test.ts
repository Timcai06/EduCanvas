import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { repository, identity, conversation } = vi.hoisted(() => ({
  repository: { updateKind: vi.fn(), cancel: vi.fn() },
  identity: { token: 'token', studentId: 'subject-1' },
  conversation: { id: 'conversation-1', spaceId: 'notebook-1' },
}));

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzleArtifactConfirmationRepository: vi.fn(function () {
      return repository;
    }),
    artifactConfirmationMessageId: (id: string, attempt = 1) =>
      attempt === 1 ? `confirm:${id}` : `confirm:${id}:attempt:${attempt}`,
  };
});
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(async () => identity),
}));
vi.mock('@/server/platform/general-request-conversation-context', () => ({
  loadOwnedGeneralRequestConversation: vi.fn(async () => conversation),
}));

import { POST } from './route';

const confirmationId = '11111111-1111-4111-8111-111111111111';
const actionRequest = (body: unknown) =>
  new Request(
    `http://localhost/api/v1/chat/artifact-confirmations/${confirmationId}`,
    {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
const context = { params: Promise.resolve({ confirmationId }) };

describe('auto artifact confirmation action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the selected kind and returns a stable idempotent turn key', async () => {
    repository.updateKind
      .mockResolvedValueOnce({
        id: confirmationId,
        status: 'pending',
        artifactKind: 'slides',
      })
      .mockResolvedValueOnce({
        id: confirmationId,
        status: 'confirmed',
        artifactKind: 'slides',
        confirmedKind: 'slides',
      });
    const first = await POST(
      actionRequest({ action: 'select', kind: 'slides' }),
      context,
    );
    const retry = await POST(
      actionRequest({ action: 'select', kind: 'slides' }),
      context,
    );
    expect(await first.json()).toEqual({
      status: 'pending',
      kind: 'slides',
      clientMessageId: `confirm:${confirmationId}`,
    });
    expect(await retry.json()).toEqual({
      status: 'confirmed',
      kind: 'slides',
      clientMessageId: `confirm:${confirmationId}`,
    });
    expect(repository.updateKind).toHaveBeenCalledTimes(2);
    expect(repository.updateKind).toHaveBeenCalledWith({
      actorUserId: identity.studentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      confirmationId,
      artifactKind: 'slides',
    });
  });

  it('allows safe repeated cancellation after a lost response', async () => {
    repository.cancel.mockResolvedValue({ status: 'cancelled' });
    const first = await POST(actionRequest({ action: 'cancel' }), context);
    const retry = await POST(actionRequest({ action: 'cancel' }), context);
    expect(await first.json()).toEqual({ status: 'cancelled' });
    expect(await retry.json()).toEqual({ status: 'cancelled' });
    expect(repository.cancel).toHaveBeenCalledTimes(2);
  });

  it('returns one durable next-attempt key after a terminal failure and reuses it on double submit', async () => {
    repository.updateKind
      .mockResolvedValueOnce({
        id: confirmationId,
        status: 'confirmed',
        artifactKind: 'slides',
        confirmedKind: 'slides',
        attemptNumber: 2,
      })
      .mockResolvedValueOnce({
        id: confirmationId,
        status: 'confirmed',
        artifactKind: 'slides',
        confirmedKind: 'slides',
        attemptNumber: 2,
      });

    const first = await POST(
      actionRequest({ action: 'select', kind: 'slides' }),
      context,
    );
    const duplicate = await POST(
      actionRequest({ action: 'select', kind: 'slides' }),
      context,
    );

    const expectedAttemptKey = `confirm:${confirmationId}:attempt:2`;
    expect(await first.json()).toMatchObject({
      status: 'confirmed',
      kind: 'slides',
      clientMessageId: expectedAttemptKey,
    });
    expect(await duplicate.json()).toMatchObject({
      status: 'confirmed',
      clientMessageId: expectedAttemptKey,
    });
  });

  it('rejects cross-origin mutations before touching pending state', async () => {
    const request = new Request(
      `http://localhost/api/v1/chat/artifact-confirmations/${confirmationId}`,
      {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'cancel' }),
      },
    );
    expect((await POST(request, context)).status).toBe(403);
    expect(repository.cancel).not.toHaveBeenCalled();
  });
});
