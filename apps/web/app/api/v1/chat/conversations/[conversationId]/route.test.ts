import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/db', () => ({
  DrizzlePlatformConversationRepository: vi.fn(),
}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  clearActiveConversationCookie: vi.fn(),
  isValidConversationId: vi.fn(),
  readActiveConversationId: vi.fn(),
  writeActiveConversationCookie: vi.fn(),
}));

import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  clearActiveConversationCookie,
  isValidConversationId,
  readActiveConversationId,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { DELETE, PATCH } from './route';

const ACTIVE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const archiveOwned = vi.fn();
const listOwnedRecent = vi.fn();
const renameOwned = vi.fn();

function request(
  method: 'DELETE' | 'PATCH' = 'DELETE',
  body?: unknown,
): Request {
  return new Request(
    `http://localhost/api/v1/chat/conversations/${ACTIVE_ID}`,
    {
      method,
      headers: {
        origin: 'http://localhost',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(DrizzlePlatformConversationRepository).mockImplementation(
    function RepositoryMock() {
      return {
        archiveOwned,
        listOwnedRecent,
        renameOwned,
      };
    } as never,
  );
  vi.mocked(readAnonymousIdentity).mockResolvedValue({
    token: '',
    studentId: 'local:owner',
  });
  vi.mocked(isValidConversationId).mockImplementation((value) =>
    /^[0-9a-f-]{36}$/i.test(value),
  );
  archiveOwned.mockResolvedValue(true);
  listOwnedRecent.mockResolvedValue([]);
  renameOwned.mockResolvedValue({
    id: ACTIVE_ID,
    title: '新的笔记本名称',
  });
});

describe('PATCH conversation', () => {
  it('在仓储调用前拒绝空标题和超长标题', async () => {
    const response = await PATCH(request('PATCH', { title: '   ' }), {
      params: Promise.resolve({ conversationId: ACTIVE_ID }),
    });

    expect(response.status).toBe(400);
    expect(renameOwned).not.toHaveBeenCalled();
  });

  it('只以服务端身份重命名所属笔记本', async () => {
    const response = await PATCH(
      request('PATCH', { title: '  新的笔记本名称  ' }),
      {
        params: Promise.resolve({ conversationId: ACTIVE_ID }),
      },
    );

    expect(response.status).toBe(200);
    expect(renameOwned).toHaveBeenCalledWith({
      conversationId: ACTIVE_ID,
      trustedSubjectId: 'local:owner',
      title: '新的笔记本名称',
    });
    await expect(response.json()).resolves.toEqual({
      conversation: { id: ACTIVE_ID, title: '新的笔记本名称' },
    });
  });

  it('跨主体或已归档笔记本统一返回不存在', async () => {
    renameOwned.mockResolvedValue(null);

    const response = await PATCH(request('PATCH', { title: '越权改名' }), {
      params: Promise.resolve({ conversationId: OTHER_ID }),
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE conversation', () => {
  it('在数据库查询前拒绝畸形UUID', async () => {
    vi.mocked(isValidConversationId).mockReturnValue(false);

    const response = await DELETE(request(), {
      params: Promise.resolve({ conversationId: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    expect(archiveOwned).not.toHaveBeenCalled();
  });

  it('删除非当前历史时不改写当前对话游标', async () => {
    vi.mocked(readActiveConversationId).mockResolvedValue(ACTIVE_ID);

    const response = await DELETE(request(), {
      params: Promise.resolve({ conversationId: OTHER_ID }),
    });

    expect(response.status).toBe(200);
    expect(listOwnedRecent).not.toHaveBeenCalled();
    expect(writeActiveConversationCookie).not.toHaveBeenCalled();
    expect(clearActiveConversationCookie).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      nextConversationId: ACTIVE_ID,
    });
  });

  it('删除当前历史后只切换到同主体的下一条记录', async () => {
    vi.mocked(readActiveConversationId).mockResolvedValue(ACTIVE_ID);
    listOwnedRecent.mockResolvedValue([{ id: OTHER_ID }]);

    const response = await DELETE(request(), {
      params: Promise.resolve({ conversationId: ACTIVE_ID }),
    });

    expect(response.status).toBe(200);
    expect(listOwnedRecent).toHaveBeenCalledWith({
      trustedSubjectId: 'local:owner',
      limit: 1,
    });
    expect(writeActiveConversationCookie).toHaveBeenCalledWith(OTHER_ID);
    expect(clearActiveConversationCookie).not.toHaveBeenCalled();
  });

  it('跨主体或已归档记录统一返回不存在', async () => {
    archiveOwned.mockResolvedValue(false);

    const response = await DELETE(request(), {
      params: Promise.resolve({ conversationId: OTHER_ID }),
    });

    expect(response.status).toBe(404);
    expect(readActiveConversationId).not.toHaveBeenCalled();
  });
});
