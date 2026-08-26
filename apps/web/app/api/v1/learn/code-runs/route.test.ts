import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  context: vi.fn(),
  trustedOrigin: vi.fn(),
  run: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.identity,
}));
vi.mock('@/server/study/study-service', () => ({
  loadOwnedStudyContext: mocks.context,
}));
vi.mock('@/server/teaching/code-exercise-runner', () => ({
  runCodeExercise: mocks.run,
}));
vi.mock('@/server/teaching/code-run-traffic-limiter', () => ({
  codeRunTrafficKey: (subjectId: string, notebookId: string) =>
    `${subjectId}:${notebookId}`,
  codeRunTrafficLimiter: { acquire: mocks.acquire },
}));
vi.mock('@/server/http/request-security', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/http/request-security')>();
  return { ...original, isTrustedSameOriginWrite: mocks.trustedOrigin };
});

import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/v1/learn/code-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/learn/code-runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.identity.mockResolvedValue({ studentId: 'student-1' });
    mocks.context.mockResolvedValue({
      plan: { goal: { notebookId: 'notebook-1' } },
      artifact: { type: 'code_completion', artifactId: 'code-1' },
    });
    mocks.run.mockResolvedValue({
      status: 'succeeded',
      stdout: '79.0\n',
      stderr: '',
      failureCode: null,
    });
    mocks.acquire.mockReturnValue({
      allowed: true,
      release: mocks.release,
    });
  });

  it('仅为当前受信练习执行代码', async () => {
    const response = await POST(
      request({ artifactId: 'code-1', source: 'print(79.0)' }),
    );

    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        notebookId: 'notebook-1',
        source: 'print(79.0)',
      }),
    );
    expect(await response.json()).toEqual({
      status: 'succeeded',
      stdout: '79.0\n',
      stderr: '',
      failureCode: null,
    });
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('拒绝跨来源写请求和不属于当前课程的 artifact', async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    expect(
      (await POST(request({ artifactId: 'code-1', source: 'print(1)' })))
        .status,
    ).toBe(403);

    mocks.trustedOrigin.mockReturnValue(true);
    const response = await POST(
      request({ artifactId: 'other-code', source: 'print(1)' }),
    );
    expect(response.status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('拒绝超长或空代码而不进入沙箱', async () => {
    const response = await POST(request({ artifactId: 'code-1', source: '' }));

    expect(response.status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('限制同一学生和 Notebook 的沙箱启动频率', async () => {
    mocks.acquire.mockReturnValue({
      allowed: false,
      reason: 'rate',
      retryAfterMs: 2_000,
    });

    const response = await POST(
      request({ artifactId: 'code-1', source: 'print(1)' }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
