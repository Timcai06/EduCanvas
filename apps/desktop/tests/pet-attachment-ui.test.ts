import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetChatPanel } from '../src/renderer/src/pet-chat-panel';

function renderAttachmentUi(input?: {
  attachmentBusy?: boolean;
  withAttachment?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(PetChatPanel as ComponentType<Record<string, unknown>>, {
      expandedView: false,
      state: 'ready',
      authState: 'signed_in',
      message: '可以开始聊天。',
      history: {
        revision: 0,
        conversationId: 'conversation:one',
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
      pendingAttachment: input?.withAttachment
        ? {
            assetId: 'asset:one',
            versionId: 'version:one',
            kind: 'image',
            mimeType: 'image/png',
            displayName: '函数图像.png',
            notebookId: 'notebook:one',
          }
        : null,
      attachmentBusy: input?.attachmentBusy ?? false,
      pickAttachment: async () => undefined,
      clearAttachment: () => undefined,
    }),
  );
}

describe('desktop attachment composer', () => {
  it('presents attachment upload as a named action instead of an ambiguous icon', () => {
    const html = renderAttachmentUi();

    expect(html).toContain('aria-label="添加图片或 PDF"');
    expect(html).toContain('>图片 / PDF</span>');
    expect(html).toContain('aria-label="发送消息"');
  });

  it('shows a stable uploading state and blocks duplicate picks', () => {
    const html = renderAttachmentUi({ attachmentBusy: true });

    expect(html).toContain('aria-label="正在上传附件"');
    expect(html).toContain('>上传中…</span>');
    expect(html).toContain('disabled=""');
  });

  it('shows the selected file and a specific remove action', () => {
    const html = renderAttachmentUi({ withAttachment: true });

    expect(html).toContain('函数图像.png');
    expect(html).toContain('图片已就绪');
    expect(html).toContain('aria-label="移除附件 函数图像.png"');
  });
});
