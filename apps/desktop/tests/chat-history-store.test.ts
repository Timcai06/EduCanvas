import { describe, expect, it } from 'vitest';
import { createChatHistoryStore } from '../src/main/chat-history-store';

const canonical = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'm-1',
  clientMessageId: 'desktop:1',
  role: 'user' as const,
  status: 'completed' as const,
  content: '你好',
  createdAt: '2026-08-14T00:00:00.000Z',
  ...overrides,
});

describe('desktop chat history store', () => {
  it('shares one ordered history snapshot across renderer windows', () => {
    const store = createChatHistoryStore();
    const observed: string[][] = [];
    store.subscribe((messages) =>
      observed.push(messages.map(({ content }) => content)),
    );

    const user = store.append({
      role: 'user',
      content: '解释勾股定理',
      source: 'text',
    });
    const assistant = store.append({
      role: 'assistant',
      content: '直角三角形两直角边平方和等于斜边平方。',
      source: 'text',
    });

    expect(store.snapshot()).toEqual([user, assistant]);
    expect(observed).toEqual([
      ['解释勾股定理'],
      ['解释勾股定理', '直角三角形两直角边平方和等于斜边平方。'],
    ]);
  });

  it('rejects blank messages and protects snapshots from mutation', () => {
    const store = createChatHistoryStore();

    expect(() =>
      store.append({ role: 'user', content: '   ', source: 'voice' }),
    ).toThrow('Chat message cannot be blank');
    const snapshot = store.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('clears history when the current conversation changes', () => {
    const store = createChatHistoryStore();
    store.append({ role: 'user', content: '旧会话', source: 'text' });
    store.clear();
    expect(store.state()).toMatchObject({ revision: 2, messages: [] });
  });

  it('partitions history by conversation and exposes the conversationId', () => {
    const store = createChatHistoryStore();
    store.append({ role: 'user', content: '旧会话', source: 'text' });
    store.setConversation('conv-1');
    expect(store.state()).toMatchObject({
      conversationId: 'conv-1',
      messages: [],
      hasMore: false,
      loading: false,
    });
  });

  it('tags optimistic messages with the request identity', () => {
    const store = createChatHistoryStore();
    const message = store.append({
      role: 'user',
      content: '你好',
      source: 'text',
      clientMessageId: 'desktop:1',
    });
    expect(message.clientMessageId).toBe('desktop:1');
  });

  it('reconciles canonical history and dedups optimistic user by clientMessageId', () => {
    const store = createChatHistoryStore();
    store.setConversation('conv-1');
    store.append({
      role: 'user',
      content: '你好',
      source: 'text',
      clientMessageId: 'desktop:1',
    });
    store.reconcile([
      canonical({ messageId: 'm-user', content: '你好' }),
      canonical({
        messageId: 'm-assistant',
        role: 'assistant',
        content: '你好呀',
      }),
    ]);

    expect(store.state().messages.map(({ id }) => id)).toEqual([
      'm-user',
      'm-assistant',
    ]);
    expect(store.state()).toMatchObject({ hasMore: false, loading: false });
  });

  it('keeps optimistic user messages not yet persisted by the server', () => {
    const store = createChatHistoryStore();
    store.setConversation('conv-1');
    store.append({
      role: 'user',
      content: '还没持久化',
      source: 'text',
      clientMessageId: 'desktop:new',
    });
    store.reconcile([canonical({ messageId: 'm-old', content: '旧消息' })]);

    expect(store.state().messages.map(({ content }) => content)).toEqual([
      '旧消息',
      '还没持久化',
    ]);
  });

  it('records pagination hasMore flag from the canonical page', () => {
    const store = createChatHistoryStore();
    store.setConversation('conv-1');
    store.reconcile([], { hasMore: true, nextCursor: 'gmh1.abc' });
    expect(store.state()).toMatchObject({
      hasMore: true,
      nextCursor: 'gmh1.abc',
    });
  });

  it('prepends an earlier page and dedups by messageId', () => {
    const store = createChatHistoryStore();
    store.setConversation('conv-1');
    store.reconcile(
      [canonical({ messageId: 'm-new', content: '最新消息' })],
      { hasMore: true, nextCursor: 'gmh1.next' },
    );
    store.prependEarlier(
      [canonical({ messageId: 'm-old', content: '更早消息' })],
      { hasMore: false, nextCursor: null },
    );

    expect(store.state().messages.map(({ id }) => id)).toEqual([
      'm-old',
      'm-new',
    ]);
    expect(store.state()).toMatchObject({ hasMore: false, nextCursor: null });
  });
});
