import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { listAccessibleRecentPage, readAnonymousIdentity } = vi.hoisted(() => ({
  listAccessibleRecentPage: vi.fn(),
  readAnonymousIdentity: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  DrizzlePlatformConversationRepository: class {
    listAccessibleRecentPage = listAccessibleRecentPage;
  },
}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity,
}));

import { GET } from './route';

describe('GET /api/v1/chat/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAnonymousIdentity.mockResolvedValue({ studentId: 'student-general' });
    listAccessibleRecentPage.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('只向通用笔记本侧栏查询 general profile 会话', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/chat/conversations'),
    );

    expect(response.status).toBe(200);
    expect(listAccessibleRecentPage).toHaveBeenCalledWith({
      trustedSubjectId: 'student-general',
      agentProfileId: 'general',
      limit: 30,
      cursor: null,
    });
  });
});
