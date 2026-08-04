import {
  WebRuntimeRunNotFoundError,
  type WebRuntimeRunSnapshot,
} from '@educanvas/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  createAuthorizedRun: vi.fn(),
  cancelAuthorizedRun: vi.fn(),
  settleAuthorizedRun: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/db', async (importActual) => {
  const actual = await importActual<typeof import('@educanvas/db')>();
  return {
    ...actual,
    DrizzleWebRuntimeRunRepository: class {
      createAuthorizedRun = repository.createAuthorizedRun;
      cancelAuthorizedRun = repository.cancelAuthorizedRun;
      settleAuthorizedRun = repository.settleAuthorizedRun;
    },
  };
});
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/canvas/web-runtime-config', () => ({
  readWebRuntimeHostConfig: vi.fn(() => ({
    runtimeOrigin: 'https://runtime.educanvas.test',
  })),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { POST as createRun } from './runs/route';
import { POST as cancelRun } from './runs/[runId]/cancel/route';
import { POST as settleRun } from './runs/[runId]/terminal/route';

const IDS = {
  request: '10000000-0000-4000-8000-000000000001',
  run: '10000000-0000-4000-8000-000000000002',
  runtime: '10000000-0000-4000-8000-000000000003',
  notebook: '10000000-0000-4000-8000-000000000004',
  artifact: '10000000-0000-4000-8000-000000000005',
  version: '10000000-0000-4000-8000-000000000006',
} as const;
const identity = {
  token: 'anonymous-token',
  studentId: `anon:v1:${'b'.repeat(64)}`,
};

function request(path: string, body?: unknown, origin = 'http://localhost') {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function run(
  status: WebRuntimeRunSnapshot['status'] = 'running',
): WebRuntimeRunSnapshot {
  return {
    id: IDS.run,
    requestId: IDS.request,
    runtimeId: IDS.runtime,
    notebookId: IDS.notebook,
    artifactId: IDS.artifact,
    artifactVersionId: IDS.version,
    artifactContentHash: 'a'.repeat(64),
    status,
    failureCode: null,
    terminalAuthority: 'client_observed',
  };
}

describe('web runtime write routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue({
      id: 'conversation-1',
      spaceId: IDS.notebook,
    } as never);
  });

  it('derives subject and Notebook server-side when creating a run', async () => {
    repository.createAuthorizedRun.mockResolvedValue(run());

    const response = await createRun(
      request('/api/v1/canvas/runtime/runs', {
        requestId: IDS.request,
        artifactId: IDS.artifact,
        artifactVersionId: IDS.version,
      }),
    );

    expect(response.status).toBe(201);
    expect(repository.createAuthorizedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: IDS.request,
        notebookId: IDS.notebook,
        trustedSubjectId: identity.studentId,
      }),
    );
    const input = repository.createAuthorizedRun.mock.calls[0]![0];
    expect(input.bootstrapToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(response.json()).resolves.toMatchObject({
      runId: IDS.run,
      runtimeOrigin: 'https://runtime.educanvas.test',
    });
  });

  it('rejects cross-origin, unauthenticated, and invalid run requests', async () => {
    const body = {
      requestId: IDS.request,
      artifactId: IDS.artifact,
      artifactVersionId: IDS.version,
    };
    const crossOrigin = await createRun(
      request('/api/v1/canvas/runtime/runs', body, 'https://evil.example'),
    );
    vi.mocked(readAnonymousIdentity).mockResolvedValueOnce(null);
    const unauthenticated = await createRun(
      request('/api/v1/canvas/runtime/runs', body),
    );
    const invalid = await createRun(
      request('/api/v1/canvas/runtime/runs', { ...body, subjectId: 'forged' }),
    );

    expect(crossOrigin.status).toBe(403);
    expect(unauthenticated.status).toBe(401);
    expect(invalid.status).toBe(404);
    expect(repository.createAuthorizedRun).not.toHaveBeenCalled();
  });

  it('hides cross-Notebook or cross-subject cancellation as 404', async () => {
    repository.cancelAuthorizedRun.mockRejectedValue(
      new WebRuntimeRunNotFoundError(),
    );

    const response = await cancelRun(
      request(`/api/v1/canvas/runtime/runs/${IDS.run}/cancel`),
      { params: Promise.resolve({ runId: IDS.run }) },
    );

    expect(response.status).toBe(404);
    expect(repository.cancelAuthorizedRun).toHaveBeenCalledWith({
      runId: IDS.run,
      notebookId: IDS.notebook,
      trustedSubjectId: identity.studentId,
    });
  });

  it('returns the repository-authoritative terminal in cancel races', async () => {
    repository.cancelAuthorizedRun.mockResolvedValue(run('succeeded'));

    const response = await cancelRun(
      request(`/api/v1/canvas/runtime/runs/${IDS.run}/cancel`),
      { params: Promise.resolve({ runId: IDS.run }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runId: IDS.run,
      status: 'succeeded',
      terminalAuthority: 'client_observed',
    });
  });

  it('validates terminal bodies and preserves the repository terminal', async () => {
    const invalid = await settleRun(
      request(`/api/v1/canvas/runtime/runs/${IDS.run}/terminal`, {
        status: 'failed',
        failureCode: 'provider_secret',
      }),
      { params: Promise.resolve({ runId: IDS.run }) },
    );
    repository.settleAuthorizedRun.mockResolvedValue(run('cancelled'));
    const raced = await settleRun(
      request(`/api/v1/canvas/runtime/runs/${IDS.run}/terminal`, {
        status: 'succeeded',
      }),
      { params: Promise.resolve({ runId: IDS.run }) },
    );

    expect(invalid.status).toBe(400);
    expect(raced.status).toBe(200);
    await expect(raced.json()).resolves.toMatchObject({ status: 'cancelled' });
  });
});
