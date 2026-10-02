import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readTeachingRequestScope } from './request-scope';
const notebookId = '83000000-0000-4000-8000-000000000001';
const conversationId = '83000000-0000-4000-8000-000000000002';
describe('Teaching navigation scope', () => {
  it('keeps the legacy entry and resolves explicit Notebook/Conversation selectors', () => {
    expect(
      readTeachingRequestScope(
        new Request('http://localhost/api/v1/learn/turn'),
      ),
    ).toBeUndefined();
    expect(
      readTeachingRequestScope(
        new Request(
          `http://localhost/api/v1/learn/turn?requestNotebookId=${notebookId}&requestConversationId=${conversationId}`,
        ),
      ),
    ).toEqual({ notebookId, conversationId });
  });
  it('rejects partial, malformed and repeated selectors without legacy fallback', () => {
    for (const query of [
      `requestConversationId=${conversationId}`,
      'requestNotebookId=bad',
      `requestNotebookId=${notebookId}&requestNotebookId=${notebookId}`,
      `requestNotebookId=${notebookId}&requestConversationId=bad`,
    ])
      expect(() =>
        readTeachingRequestScope(
          new Request(`http://localhost/api/v1/learn/turn?${query}`),
        ),
      ).toThrow('invalid_request');
  });
});
