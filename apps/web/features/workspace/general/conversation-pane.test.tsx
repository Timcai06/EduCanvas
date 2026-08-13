import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ConversationPane,
  projectArtifactGenerationIntoMessages,
} from './conversation-pane';
import type { ChatMessage } from '@/features/chat/messages';
import type { ArtifactDetail } from '@/features/canvas/artifact-client';

let composerProps: Record<string, unknown> = {};

vi.mock('@/features/voice', () => ({
  VoiceComposer: (props: Record<string, unknown>) => {
    composerProps = props;
    return null;
  },
}));

vi.mock('@/features/chat/chat-panel', () => ({
  ChatPanel: () => <div data-chat-panel />,
}));

vi.mock('@/features/chat/assistant-message-projection', () => ({
  useAssistantMessageProjection: () => ({
    assistantId: null,
    assistantText: '',
    assistantStatus: null,
    assistantArtifacts: [],
    assistantCitations: [],
    assistantToolSteps: [],
  }),
}));

describe('ConversationPane 与 Composer 输出偏好回调', () => {
  it('用同一 Artifact ID 原位投影生成终态且不追加完成卡', () => {
    const messages: readonly ChatMessage[] = [
      {
        id: 'assistant-1',
        turnId: 'turn-1',
        clientMessageId: 'client-1',
        role: 'assistant',
        status: 'completed',
        text: '已开始生成',
        attachments: [],
        artifacts: [
          {
            id: 'artifact-1',
            kind: 'mind_map',
            title: '思维导图',
            status: 'proposed',
            latestVersion: 0,
          },
        ],
      },
    ];

    const projected = projectArtifactGenerationIntoMessages(messages, {
      artifactId: 'artifact-1',
      kind: 'mind_map',
      title: '思维导图',
      phase: 'failed',
      outcome: 'cancelled',
    });

    expect(projected).toHaveLength(1);
    expect(
      projected[0]?.role === 'assistant' ? projected[0].artifacts : [],
    ).toEqual([
      expect.objectContaining({
        id: 'artifact-1',
        status: 'cancelled',
        latestVersion: 0,
      }),
    ]);
  });

  it.each(['failed', 'cancelled', 'timed_out'] as const)(
    '已有版本的 revision %s 保持聊天与 Live 的对象级 active 事实',
    (revisionOutcome) => {
      const messages: readonly ChatMessage[] = [
        {
          id: 'assistant-1',
          turnId: 'turn-1',
          clientMessageId: 'client-1',
          role: 'assistant',
          status: 'completed',
          text: '已有产物',
          attachments: [],
          artifacts: [
            {
              id: 'artifact-1',
              kind: 'mind_map',
              title: '思维导图',
              status: 'active',
              latestVersion: 2,
            },
          ],
        },
      ];

      const projected = projectArtifactGenerationIntoMessages(messages, {
        artifactId: 'artifact-1',
        kind: 'mind_map',
        title: '思维导图',
        phase: 'ready',
        outcome: 'ready',
        revisionOutcome,
        detail: {
          artifact: { latestVersion: 2 },
        } as ArtifactDetail,
      });

      expect(
        projected[0]?.role === 'assistant' ? projected[0].artifacts : [],
      ).toEqual([
        expect.objectContaining({
          id: 'artifact-1',
          status: 'active',
          latestVersion: 2,
        }),
      ]);
    },
  );

  it('消息卡已存在时仍显示可恢复 timed_out 状态提示', () => {
    const html = renderToStaticMarkup(
      <ConversationPane
        isLanding={false}
        notebookId="notebook-1"
        messages={[
          {
            id: 'assistant-1',
            turnId: 'turn-1',
            clientMessageId: 'client-1',
            role: 'assistant',
            status: 'completed',
            text: '开始生成',
            attachments: [],
            artifacts: [
              {
                id: 'artifact-1',
                kind: 'mind_map',
                title: '思维导图',
                status: 'proposed',
                latestVersion: 0,
              },
            ],
          },
        ]}
        busy={false}
        stopAvailable={false}
        statusText={null}
        statusTone="info"
        generation={{
          artifactId: 'artifact-1',
          kind: 'mind_map',
          title: '思维导图',
          phase: 'generating',
          outcome: 'timed_out',
        }}
        revisingOpenArtifact={false}
        composerTools={[]}
        outputPreference="auto"
        liveAssets={[]}
        composerDockRef={{ current: null }}
        scrollRef={{ current: null }}
        nearBottomRef={{ current: true }}
        onSend={vi.fn()}
        onLiveSend={vi.fn()}
        onStop={vi.fn()}
        onMenuAction={vi.fn()}
        onToolAction={vi.fn()}
        onOutputPreferenceChange={vi.fn()}
        onRetry={vi.fn()}
        onPreviewHtml={vi.fn()}
        onOpenArtifact={vi.fn()}
        onToggleLiveAsset={vi.fn()}
        onUploadLiveAsset={vi.fn()}
        onOpenStatusCard={vi.fn()}
        onDismissStatusCard={vi.fn()}
      />,
    );

    expect(html).toContain('后台仍在处理，可关闭提示并稍后从资源库查看');
    expect(html).not.toContain('data-turn-context-strip');
    expect(html.indexOf('data-chat-panel')).toBeLessThan(
      html.indexOf('data-conversation-tail-artifact'),
    );
  });

  it('成功 revision 且已有消息卡时不显示重复浮动状态卡', () => {
    const html = renderToStaticMarkup(
      <ConversationPane
        isLanding={false}
        notebookId="notebook-1"
        messages={[
          {
            id: 'assistant-1',
            turnId: 'turn-1',
            clientMessageId: 'client-1',
            role: 'assistant',
            status: 'completed',
            text: '已存在的产物',
            attachments: [],
            artifacts: [
              {
                id: 'artifact-1',
                kind: 'mind_map',
                title: '思维导图',
                status: 'active',
                latestVersion: 2,
              },
            ],
          },
        ]}
        busy={false}
        stopAvailable={false}
        statusText={null}
        statusTone="info"
        generation={{
          artifactId: 'artifact-1',
          kind: 'mind_map',
          title: '思维导图',
          phase: 'ready',
          outcome: 'ready',
          revisionOutcome: undefined,
          detail: {
            artifact: {
              id: 'artifact-1',
              kind: 'mind_map',
              status: 'active',
              latestVersion: 2,
            } as never,
          } as never,
        }}
        revisingOpenArtifact={false}
        composerTools={[]}
        outputPreference="auto"
        liveAssets={[]}
        composerDockRef={{ current: null }}
        scrollRef={{ current: null }}
        nearBottomRef={{ current: true }}
        onSend={vi.fn()}
        onLiveSend={vi.fn()}
        onStop={vi.fn()}
        onMenuAction={vi.fn()}
        onToolAction={vi.fn()}
        onOutputPreferenceChange={vi.fn()}
        onRetry={vi.fn()}
        onPreviewHtml={vi.fn()}
        onOpenArtifact={vi.fn()}
        onToggleLiveAsset={vi.fn()}
        onUploadLiveAsset={vi.fn()}
        onOpenStatusCard={vi.fn()}
        onDismissStatusCard={vi.fn()}
      />,
    );

    expect(html).not.toContain('打开');
    expect(html).not.toContain('已生成');
    expect(html).not.toContain('已更新至');
  });

  it('将 outputPreference 与 onOutputPreferenceChange 透传给 VoiceComposer', () => {
    const onOutputPreferenceChange = vi.fn();
    renderToStaticMarkup(
      <ConversationPane
        isLanding={false}
        notebookId="notebook-1"
        messages={[]}
        busy={false}
        stopAvailable={false}
        statusText={null}
        statusTone="info"
        generation={null}
        revisingOpenArtifact={false}
        composerTools={[]}
        outputPreference="web_app"
        liveAssets={[]}
        composerDockRef={{ current: null }}
        scrollRef={{ current: null }}
        nearBottomRef={{ current: true }}
        onSend={vi.fn()}
        onLiveSend={vi.fn()}
        onStop={vi.fn()}
        onMenuAction={vi.fn()}
        onToolAction={vi.fn()}
        onOutputPreferenceChange={onOutputPreferenceChange}
        onRetry={vi.fn()}
        onPreviewHtml={vi.fn()}
        onOpenArtifact={vi.fn()}
        onToggleLiveAsset={vi.fn()}
        onUploadLiveAsset={vi.fn()}
        onOpenStatusCard={vi.fn()}
        onDismissStatusCard={vi.fn()}
      />,
    );

    expect(composerProps.outputPreference).toBe('web_app');
    expect(typeof composerProps.onOutputPreferenceChange).toBe('function');
    (composerProps.onOutputPreferenceChange as (preference: string) => void)(
      'interactive_artifact',
    );
    expect(onOutputPreferenceChange).toHaveBeenCalledWith(
      'interactive_artifact',
    );
  });
});
