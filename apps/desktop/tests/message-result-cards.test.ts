import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PetChatPanel } from '../src/renderer/src/pet-chat-panel';

describe('desktop structured result cards', () => {
  it('renders traceable citation, image, artifact, tool and unsupported-part cards', () => {
    const html = renderToStaticMarkup(
      createElement(PetChatPanel as ComponentType<Record<string, unknown>>, {
        expandedView: true,
        state: 'ready',
        message: '完成',
        history: {
          revision: 1,
          conversationId: 'conversation:one',
          hasMore: false,
          nextCursor: null,
          loading: false,
          messages: [
            {
              id: 'message:one',
              clientMessageId: 'desktop:one',
              role: 'assistant',
              content: '这是整理后的结果。',
              source: 'text',
              status: 'completed',
              createdAt: '2026-08-15T00:00:00.000Z',
              citations: [
                {
                  citationId: 'citation:one',
                  marker: 1,
                  label: '课程讲义',
                  target: {
                    kind: 'knowledge',
                    sourceId: 'source:one',
                    documentId: 'document:one',
                    chunkId: 'chunk:one',
                    pageStart: 3,
                    pageEnd: 3,
                  },
                },
              ],
              parts: [
                {
                  type: 'image',
                  assetId: 'asset:image',
                  versionId: 'version:image',
                  label: '几何示意图',
                },
                {
                  type: 'unsupported',
                  partType: 'asset_ref:video',
                  label: '视频内容',
                  target: {
                    kind: 'asset',
                    assetId: 'asset:video',
                    assetVersionId: 'version:video',
                  },
                },
              ],
              artifacts: [
                {
                  artifactId: 'artifact:one',
                  artifactKind: 'mind_map',
                  title: '函数思维导图',
                  status: 'version_added',
                  versionId: 'version:artifact',
                },
                {
                  artifactId: 'artifact:two',
                  artifactKind: 'slides',
                  title: '课程幻灯片',
                  status: 'generating',
                  progress: 0.5,
                },
              ],
              toolActivities: [
                {
                  toolCallId: 'tool:one',
                  summary: '正在查找相关资料',
                  status: 'completed',
                },
              ],
            },
          ],
        },
        historyEndRef: { current: null },
        text: '',
        busy: false,
        canStop: false,
        lastAssistantReply: '这是整理后的结果。',
        setText: () => undefined,
        collapse: () => undefined,
        submit: async () => undefined,
        startVoice: async () => undefined,
        speakLatest: async () => undefined,
        cancel: () => undefined,
        resume: async () => undefined,
        canResume: false,
        directory: {
          revision: 1,
          loading: false,
          conversations: [],
          currentConversationId: 'conversation:one',
          error: null,
        },
        selectConversation: async () => undefined,
        createConversation: async () => undefined,
        openResult: async () => undefined,
      }),
    );

    expect(html).toContain('aria-label="引用来源"');
    expect(html).toContain('[1]');
    expect(html).toContain('课程讲义');
    expect(html).toContain('查看来源');
    expect(html).toContain('aria-label="图片预览：几何示意图"');
    expect(html).toContain('函数思维导图');
    expect(html).toContain('已生成');
    expect(html).toContain('生成中 50%');
    expect(html).toContain('正在查找相关资料');
    expect(html).toContain('处理完成');
    expect(html).toContain('此内容需要在 Web 查看');
    expect(html).toContain('在 EduCanvas 中打开');
  });
});
