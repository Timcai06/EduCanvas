import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetChatPanel } from '../src/renderer/src/pet-chat-panel';

function renderPanel(
  authState: 'checking' | 'signed_out' | 'signed_in',
): string {
  return renderToStaticMarkup(
    createElement(PetChatPanel as ComponentType<Record<string, unknown>>, {
      expandedView: false,
      state: 'ready',
      authState,
      message: '你好',
      history: {
        revision: 0,
        conversationId: null,
        messages: [],
        hasMore: false,
        nextCursor: null,
        loading: false,
      },
      historyEndRef: { current: null },
      text: '',
      busy: false,
      canStop: false,
      lastAssistantReply: '',
      speakingMessageId: null,
      setText: () => undefined,
      collapse: () => undefined,
      submit: async () => undefined,
      signIn: async () => undefined,
      startVoice: async () => undefined,
      speakLatest: async () => undefined,
      speakMessage: async () => undefined,
      cancel: () => undefined,
      resume: async () => undefined,
      canResume: false,
      directory: {
        revision: 0,
        loading: false,
        conversations: [],
        currentConversationId: null,
        error: null,
      },
      selectConversation: async () => undefined,
      createConversation: async () => undefined,
      openResult: async () => undefined,
    }),
  );
}

describe('desktop unauthenticated chat gate', () => {
  it('does not flash the wrong control while authentication is loading', () => {
    const html = renderPanel('checking');

    expect(html).not.toContain('>请先登录</button>');
    expect(html).not.toContain('aria-label="输入消息"');
  });

  it('replaces the composer with a login button while signed out', () => {
    const html = renderPanel('signed_out');

    expect(html).toContain('>请先登录</button>');
    expect(html).not.toContain('aria-label="输入消息"');
    expect(html).not.toContain('>发送</button>');
  });

  it('shows the composer after the user signs in', () => {
    const html = renderPanel('signed_in');

    expect(html).toContain('aria-label="输入消息"');
    expect(html).toContain('aria-label="开始语音输入"');
    expect(html).toContain('aria-label="朗读最新回复"');
    expect(html).not.toContain('>请先登录</button>');
  });
});
