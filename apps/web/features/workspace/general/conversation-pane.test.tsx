import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationPane } from './conversation-pane';
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
