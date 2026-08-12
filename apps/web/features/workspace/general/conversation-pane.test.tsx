import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ConversationPane,
  projectArtifactGenerationIntoMessages,
} from './conversation-pane';
import type { ChatMessage } from '@/features/chat/messages';
import { buildTurnContextSnapshot } from '@/features/chat/turn-context-snapshot';

let composerProps: Record<string, unknown> = {};

vi.mock('@/features/voice', () => ({
  VoiceComposer: (props: Record<string, unknown>) => {
    composerProps = props;
    return null;
  },
}));

vi.mock('@/features/chat/chat-panel', () => ({
  ChatPanel: () => null,
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
        turnContextSnapshot={buildTurnContextSnapshot([])}
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
