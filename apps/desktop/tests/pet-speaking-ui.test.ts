import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetChatPanel } from '../src/renderer/src/pet-chat-panel';

function renderSpeakingPanel(): string {
  return renderToStaticMarkup(
    createElement(PetChatPanel as ComponentType<Record<string, unknown>>, {
      expandedView: false,
      state: 'speaking',
      authState: 'signed_in',
      message: '这句话不应再次显示。',
      history: {
        revision: 1,
        conversationId: 'conversation:one',
        messages: [
          {
            id: 'message:assistant:one',
            role: 'assistant',
            content: '这句话不应再次显示。',
            source: 'text',
            status: 'completed',
          },
        ],
        hasMore: false,
        nextCursor: null,
        loading: false,
      },
      historyEndRef: { current: null },
      text: '播报时仍可继续输入',
      busy: true,
      canStop: true,
      lastAssistantReply: '这句话不应再次显示。',
      speakingMessageId: 'message:assistant:one',
      setText: () => undefined,
      collapse: () => undefined,
      submit: async () => undefined,
      signIn: async () => undefined,
      startVoice: async () => undefined,
      speakLatest: async () => undefined,
      speakMessage: async () => undefined,
      prepareSpeech: () => undefined,
      cancelSpeechPreparation: () => undefined,
      cancel: () => undefined,
      resume: async () => undefined,
      canResume: false,
      directory: {
        revision: 1,
        loading: false,
        conversations: [
          {
            conversationId: 'conversation:one',
            notebookId: 'notebook:one',
            notebookTitle: '默认笔记本',
            title: '新对话',
            membershipRole: 'owner',
          },
        ],
        currentConversationId: 'conversation:one',
        error: null,
      },
      selectConversation: async () => undefined,
      createConversation: async () => undefined,
      openResult: async () => undefined,
      pendingAttachment: null,
      attachmentBusy: false,
      pickAttachment: async () => undefined,
      clearAttachment: () => undefined,
    }),
  );
}

describe('desktop speech interaction', () => {
  it('marks only the source message as speaking without duplicating its text', () => {
    const html = renderSpeakingPanel();

    expect(html.match(/这句话不应再次显示。/g)).toHaveLength(1);
    expect(html).toContain('>正在朗读</span>');
    expect(html).toContain('aria-label="停止朗读"');
  });

  it('keeps the composer editable while audio playback is active', () => {
    const html = renderSpeakingPanel();
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? '';

    expect(textarea).not.toContain('disabled');
    expect(html).toContain('>播报时仍可继续输入</textarea>');
  });
});
