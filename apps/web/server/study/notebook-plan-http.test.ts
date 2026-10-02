import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  listChapters: vi.fn(),
  createChapter: vi.fn(),
  updateStatus: vi.fn(),
  AccessError: class extends Error {},
  ConflictError: class extends Error {},
  InputError: class extends Error {},
  NotFoundError: class extends Error {},
}));
vi.mock('@educanvas/db', () => ({
  DrizzleNotebookPlanRepository: class {
    list = mocks.list;
    create = mocks.create;
    listChapters = mocks.listChapters;
    createChapter = mocks.createChapter;
    updateStatus = mocks.updateStatus;
  },
  NotebookAccessNotFoundError: mocks.AccessError,
  NotebookPlanConflictError: mocks.ConflictError,
  NotebookPlanInputError: mocks.InputError,
  NotebookPlanNotFoundError: mocks.NotFoundError,
}));
vi.mock('../identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.identity,
}));
import { GET, POST } from '@/app/api/v1/notebooks/[notebookId]/plans/route';
import { POST as createChapter } from '@/app/api/v1/notebooks/[notebookId]/chapters/route';
import { PATCH } from '@/app/api/v1/notebooks/[notebookId]/plans/[planId]/route';
const notebookId = '83000000-0000-4000-8000-000000000001';
const planId = '83000000-0000-4000-8000-000000000002';
const context = { params: Promise.resolve({ notebookId, planId }) };
function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/v1/notebooks/${notebookId}/plans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const input = {
  title: 'Exam preparation',
  source: { kind: 'purpose', purpose: 'Prepare for exam' },
};
describe('Notebook source plan HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ studentId: 'user:trusted' });
    mocks.list.mockResolvedValue({ plans: [], goal: null, canWrite: true });
    mocks.create.mockResolvedValue({ id: planId });
    mocks.createChapter.mockResolvedValue({ id: planId });
    mocks.updateStatus.mockResolvedValue({ id: planId, status: 'completed' });
  });
  it('uses route Notebook and trusted identity and returns private no-store projections', async () => {
    const response = await GET(request(input), context);
    expect(mocks.list).toHaveBeenCalledWith({
      notebookId,
      trustedSubjectId: 'user:trusted',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      plans: [],
      goal: null,
      canWrite: true,
    });
  });
  it('requires identity and rejects invalid UUID before database access', async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(request(input), context)).status).toBe(401);
    mocks.identity.mockResolvedValue({ studentId: 'user:trusted' });
    expect(
      (
        await GET(request(input), {
          params: Promise.resolve({ notebookId: 'bad' }),
        })
      ).status,
    ).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('rejects cross-origin writes before parsing or invoking storage', async () => {
    expect(
      (
        await POST(
          request(input, { origin: 'https://attacker.example' }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it('saves explicit content and creates an idempotency UUID without accepting client authority fields', async () => {
    const response = await POST(request(input), context);
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        notebookId,
        trustedSubjectId: 'user:trusted',
        title: input.title,
        source: input.source,
        clientRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      }),
    );
    expect(
      (
        await POST(
          request({ ...input, trustedSubjectId: 'user:other' }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request({ ...input, notebookId: planId }), context)).status,
    ).toBe(400);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('only accepts explicit chapter locator data, rejecting inferred provenance', async () => {
    expect(
      (
        await createChapter(
          request({
            assetId: notebookId,
            assetVersionId: planId,
            title: 'Whole material',
            locator: { kind: 'whole' },
          }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await createChapter(
          request({
            assetId: notebookId,
            assetVersionId: planId,
            title: 'Guess',
            origin: 'model_inferred',
            locator: { kind: 'whole' },
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.createChapter).toHaveBeenCalledTimes(1);
  });
  it('bounds request bytes and maps conflict/permission errors without details', async () => {
    expect(
      (
        await POST(
          request({ ...input, description: 'x'.repeat(25000) }),
          context,
        )
      ).status,
    ).toBe(413);
    mocks.create.mockRejectedValue(
      new mocks.ConflictError('private conflict body'),
    );
    expect((await POST(request(input), context)).status).toBe(409);
    mocks.create.mockRejectedValue(
      new mocks.AccessError('private membership body'),
    );
    const denied = await POST(request(input), context);
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain('private');
  });
  it('updates only a selected Notebook plan, accepts the status contract and hides internal failures', async () => {
    expect(
      (await PATCH(request({ status: 'completed' }), context)).status,
    ).toBe(200);
    expect(mocks.updateStatus).toHaveBeenCalledWith({
      notebookId,
      planId,
      trustedSubjectId: 'user:trusted',
      status: 'completed',
    });
    expect(
      (await PATCH(request({ status: 'completed', mastery: 100 }), context))
        .status,
    ).toBe(400);
    mocks.updateStatus.mockRejectedValue(
      new Error('postgres detail and stack'),
    );
    const response = await PATCH(request({ status: 'archived' }), context);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('postgres');
  });
});
