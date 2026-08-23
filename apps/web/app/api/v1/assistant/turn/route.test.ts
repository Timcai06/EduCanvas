import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/db', () => ({
  DrizzlePlatformConversationRepository: vi.fn(),
  DrizzleTurnUsageBudgetLedger: vi.fn(),
}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
  writeActiveConversationCookie: vi.fn(),
  clearActiveConversationCookie: vi.fn(),
}));
vi.mock('@/server/assistant/rate-limit', () => ({
  checkAssistantRateLimit: vi.fn(() => ({ allowed: true })),
  resetAssistantRateLimit: vi.fn(),
}));
vi.mock('@/server/assistant/assistant-classify', () => ({
  AssistantClassifyError: class AssistantClassifyError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  createAssistantClassifyDependencies: vi.fn(),
  runClassifiedTurn: vi.fn(),
}));

import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  clearActiveConversationCookie,
  loadOwnedGeneralConversation,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { checkAssistantRateLimit } from '@/server/assistant/rate-limit';
import {
  AssistantClassifyError,
  runClassifiedTurn,
} from '@/server/assistant/assistant-classify';
import { POST } from './route';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const NOTEBOOK_ID = '22222222-2222-4222-8222-222222222222';

const listOwnedRecent = vi.fn();
const listAccessibleRecentPage = vi.fn();
const create = vi.fn();
const renameOwned = vi.fn();
const archiveOwned = vi.fn();
const getOwned = vi.fn();

function assistantRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/assistant/turn', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** 构造一个合法的分类响应；默认 unknown，用例按需覆盖。 */
function classifyResponse(response: unknown) {
  vi.mocked(runClassifiedTurn).mockResolvedValue(response as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(DrizzlePlatformConversationRepository).mockImplementation(
    function RepositoryMock() {
      return {
        listOwnedRecent,
        listAccessibleRecentPage,
        create,
        renameOwned,
        archiveOwned,
        getOwned,
      };
    } as never,
  );
  vi.mocked(readAnonymousIdentity).mockResolvedValue({
    token: '',
    studentId: 'local:owner',
  });
  vi.mocked(loadOwnedGeneralConversation).mockResolvedValue({
    id: CONVERSATION_ID,
    agentProfileId: 'general',
  } as never);
  listOwnedRecent.mockResolvedValue([{ id: NOTEBOOK_ID, title: '数学笔记' }]);
  listAccessibleRecentPage.mockResolvedValue({
    items: [{ id: NOTEBOOK_ID, title: '数学笔记' }],
    nextCursor: null,
  });
  create.mockResolvedValue({ id: CONVERSATION_ID });
  renameOwned.mockResolvedValue({ id: NOTEBOOK_ID, title: '新名字' });
  archiveOwned.mockResolvedValue(true);
  // switch_notebook 现在直接按 id 查询；默认仅 NOTEBOOK_ID 属于当前主体。
  getOwned.mockImplementation(async (input: { conversationId: string }) =>
    input.conversationId === NOTEBOOK_ID
      ? { id: NOTEBOOK_ID, title: '数学笔记' }
      : null,
  );
  vi.mocked(writeActiveConversationCookie).mockResolvedValue(undefined);
  vi.mocked(clearActiveConversationCookie).mockResolvedValue(undefined);
  vi.mocked(checkAssistantRateLimit).mockReturnValue({ allowed: true });
  classifyResponse({ action: 'unknown' });
});

describe('assistant turn 路由安全边界', () => {
  it('非同源请求返回 403', async () => {
    const request = new Request('http://localhost/api/v1/assistant/turn', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ text: 'hi' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('未开始对话（无身份）返回 401', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);
    const response = await POST(assistantRequest({ text: 'hi' }));
    expect(response.status).toBe(401);
  });

  it('无当前对话返回 404', async () => {
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(null);
    const response = await POST(assistantRequest({ text: 'hi' }));
    expect(response.status).toBe(404);
  });

  it('超过主体限流时返回 429 且不触发分类', async () => {
    vi.mocked(checkAssistantRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1_250,
    });

    const response = await POST(assistantRequest({ text: '列出笔记本' }));

    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe('rate_limited');
    expect(runClassifiedTurn).not.toHaveBeenCalled();
  });

  it('空指令与超长指令返回 400', async () => {
    expect((await POST(assistantRequest({ text: '   ' }))).status).toBe(400);
    expect(
      (await POST(assistantRequest({ text: 'x'.repeat(2049) }))).status,
    ).toBe(400);
  });
});

describe('assistant turn 意图分发', () => {
  it('list_notebooks 返回笔记本列表', async () => {
    classifyResponse({ action: 'list_notebooks' });
    const response = await POST(assistantRequest({ text: '有哪些笔记本' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toContain('数学笔记');
  });

  it('create_notebook 创建并写活跃对话 cookie', async () => {
    classifyResponse({ action: 'create_notebook', title: '物理' });
    const response = await POST(assistantRequest({ text: '新建物理笔记本' }));
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSubjectId: 'local:owner' }),
    );
    expect(writeActiveConversationCookie).toHaveBeenCalled();
  });

  it('同 clientMessageId 的重复 create 被内存幂等去重', async () => {
    classifyResponse({ action: 'create_notebook', title: '物理' });
    const body = JSON.stringify({
      text: '新建物理笔记本',
      clientMessageId: 'dedup-key-1',
    });
    await POST(
      new Request('http://localhost/api/v1/assistant/turn', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        body,
      }),
    );
    await POST(
      new Request('http://localhost/api/v1/assistant/turn', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        body,
      }),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rename_notebook 走所有权检查；未提供 notebookId 时给出提示', async () => {
    classifyResponse({
      action: 'rename_notebook',
      notebookId: NOTEBOOK_ID,
      title: '新名字',
    });
    await POST(assistantRequest({ text: '重命名' }));
    expect(renameOwned).toHaveBeenCalledWith(
      expect.objectContaining({ trustedSubjectId: 'local:owner' }),
    );

    classifyResponse({ action: 'rename_notebook', title: '没带id' });
    const response = await POST(assistantRequest({ text: '重命名' }));
    expect(renameOwned).toHaveBeenCalledTimes(1);
    expect((await response.json()).message).toContain('请指定');
  });

  it('delete_notebook 不存在或无权时给出提示', async () => {
    classifyResponse({ action: 'delete_notebook', notebookId: NOTEBOOK_ID });
    await POST(assistantRequest({ text: '删除' }));
    expect(archiveOwned).toHaveBeenCalled();

    archiveOwned.mockResolvedValueOnce(false);
    classifyResponse({ action: 'delete_notebook', notebookId: NOTEBOOK_ID });
    const response = await POST(assistantRequest({ text: '删除' }));
    expect((await response.json()).message).toContain('不存在或无权');
  });

  it('删除当前笔记本后清除活跃对话 cookie', async () => {
    classifyResponse({
      action: 'delete_notebook',
      notebookId: CONVERSATION_ID,
    });

    await POST(assistantRequest({ text: '删除当前笔记本' }));

    expect(clearActiveConversationCookie).toHaveBeenCalledOnce();
  });

  it('switch_notebook 可按标题切换到最近 50 条之外的笔记本', async () => {
    listOwnedRecent.mockResolvedValueOnce([]);
    classifyResponse({ action: 'switch_notebook', title: '数学笔记' });
    await POST(assistantRequest({ text: '切换到数学' }));
    expect(writeActiveConversationCookie).toHaveBeenCalledWith(NOTEBOOK_ID);

    expect(listAccessibleRecentPage).toHaveBeenCalledWith(
      expect.objectContaining({ trustedSubjectId: 'local:owner', limit: 100 }),
    );
  });

  it('switch_notebook 的模型 ID 仍必须通过所有权检查', async () => {
    classifyResponse({
      action: 'switch_notebook',
      notebookId: '99999999-9999-4999-8999-999999999999',
    });
    const response = await POST(assistantRequest({ text: '切换到别的' }));
    expect((await response.json()).message).toContain('找不到');
  });

  it('list_artifacts 经内部请求读取产物列表', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifacts: [{ kind: 'mind_map', title: '宇宙导图' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      classifyResponse({ action: 'list_artifacts' });
      const response = await POST(assistantRequest({ text: '有哪些产物' }));
      expect(response.status).toBe(200);
      expect((await response.json()).message).toContain('宇宙导图');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('open_artifact 按标题匹配并返回 artifactId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          artifacts: [{ id: 'art-1', kind: 'mind_map', title: '宇宙导图' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      classifyResponse({ action: 'open_artifact', title: '宇宙' });
      const response = await POST(assistantRequest({ text: '打开宇宙导图' }));
      const body = await response.json();
      expect(body.action).toBe('open_artifact');
      expect(body.artifactId).toBe('art-1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('open_panel 返回面板名；unknown 返回能力说明', async () => {
    classifyResponse({ action: 'open_panel', panel: 'create_mind_map' });
    const panelResponse = await POST(
      assistantRequest({ text: '生成思维导图' }),
    );
    expect((await panelResponse.json()).panel).toBe('create_mind_map');

    classifyResponse({ action: 'unknown' });
    const unknownResponse = await POST(assistantRequest({ text: '随便说说' }));
    expect((await unknownResponse.json()).message).toContain('我可以帮你');
  });
});

describe('assistant turn 预算与错误映射', () => {
  it('预算超限返回 429 稳定错误码', async () => {
    vi.mocked(runClassifiedTurn).mockRejectedValue(
      new AssistantClassifyError('budget_exceeded'),
    );
    const response = await POST(assistantRequest({ text: 'hi' }));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe('budget_exceeded');
  });

  it('模型不可用返回 503', async () => {
    vi.mocked(runClassifiedTurn).mockRejectedValue(
      new AssistantClassifyError('model_unavailable'),
    );
    const response = await POST(assistantRequest({ text: 'hi' }));
    expect(response.status).toBe(503);
  });

  it('分类失败返回 503', async () => {
    vi.mocked(runClassifiedTurn).mockRejectedValue(
      new AssistantClassifyError('model_failed'),
    );
    const response = await POST(assistantRequest({ text: 'hi' }));
    expect(response.status).toBe(503);
  });
});
