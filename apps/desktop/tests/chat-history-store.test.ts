import { describe, expect, it } from 'vitest';
import { createChatHistoryStore } from '../src/main/chat-history-store';

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
});
