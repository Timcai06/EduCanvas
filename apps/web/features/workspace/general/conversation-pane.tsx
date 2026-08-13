'use client';

import type { RefObject } from 'react';
import type {
  AssistantMessage,
  ChatMessage,
  MessageArtifactDTO,
} from '@/features/chat/messages';
import { ChatPanel } from '@/features/chat/chat-panel';
import { useAssistantMessageProjection } from '@/features/chat/assistant-message-projection';
import type { ComposerToolChip } from '@/features/composer/composer';
import { VoiceComposer } from '@/features/voice';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import {
  ArtifactStatusCard,
  type GenerationState,
} from '@/features/canvas/artifact-generation-flow';
import { EmptyChatHero } from '../shared/empty-chat-hero';
import { GENERAL_MENU_ACTIONS } from './general-chat-config';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { LiveVoiceContextSnapshot } from '@/features/voice/live-voice-context';
import type { LiveVoiceExitPayload } from '@/features/voice/live-voice-bring-back';
import type { OutputPreference } from '@educanvas/agent-core';

/**
 * 消息与 Composer（W02）。
 *
 * 收敛 landing 与对话两套几乎重复的 Composer + ArtifactStatusCard 分支为单一组件：
 * - landing 态渲染 EmptyChatHero + 吸顶 Composer（variant="landing"）；
 * - 对话态渲染滚动消息列 + 吸底 Composer dock。
 *
 * 本组件不持有对话/互斥状态，只负责把父级传入的 messages、busy、status 与回调
 * 渲染成两态之一；`scrollRef`/`nearBottom` 为与控制器共享的 DOM 引用。
 */
export interface ConversationPaneProps {
  isLanding: boolean;
  notebookId: string;
  nickname?: string | null;
  messages: readonly ChatMessage[];
  busy: boolean;
  stopAvailable: boolean;
  statusText: string | null;
  statusTone: 'info' | 'error';
  generation: GenerationState | null;
  revisingOpenArtifact: boolean;
  composerTools: readonly ComposerToolChip[];
  outputPreference: OutputPreference;
  liveAssets: readonly AssetItem[];
  composerDockRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: RefObject<boolean>;
  onSend: (text: string) => void;
  onLiveSend: (text: string, context: LiveVoiceContextSnapshot) => void;
  onStop: () => void;
  onMenuAction: (action: PlusMenuActionId) => void;
  onToolAction: () => void;
  onOutputPreferenceChange: (preference: OutputPreference) => void;
  onRetry: (messageId: string) => void;
  onPreviewHtml: (source: string) => void;
  onOpenArtifact: (artifactId: string) => void;
  onToggleLiveAsset: (assetId: string) => void;
  onUploadLiveAsset: (file: File, kind: 'image' | 'document') => Promise<void>;
  onOpenStatusCard: (artifactId: string) => void;
  onDismissStatusCard: () => void;
  /** Live 出室瞬间回调（EXIT 时同步触发）：信笺等带回写库与退场动画并行。 */
  onLiveExit?: (payload: LiveVoiceExitPayload) => void;
}

export function projectArtifactGenerationIntoMessages(
  messages: readonly ChatMessage[],
  generation: GenerationState | null,
): readonly ChatMessage[] {
  if (!generation?.artifactId) return messages;
  const latestVersion = Math.max(
    ...messages.flatMap((message) =>
      message.role === 'assistant'
        ? (message.artifacts ?? [])
            .filter((artifact) => artifact.id === generation.artifactId)
            .map((artifact) => artifact.latestVersion)
        : [],
    ),
    generation.detail?.artifact.latestVersion ?? 0,
  );
  const status: MessageArtifactDTO['status'] =
    generation.outcome === 'cancelled'
      ? 'cancelled'
      : generation.phase === 'failed'
        ? 'failed'
        : generation.phase === 'ready'
          ? 'active'
          : latestVersion > 0
            ? 'active'
            : 'proposed';
  let matched = false;
  const projected = messages.map((message) => {
    if (message.role !== 'assistant' || !message.artifacts) return message;
    const artifacts = message.artifacts.map((artifact) => {
      if (artifact.id !== generation.artifactId) return artifact;
      matched = true;
      return {
        ...artifact,
        title: generation.title || artifact.title,
        status,
        latestVersion,
      };
    });
    return { ...message, artifacts } satisfies AssistantMessage;
  });
  return matched ? projected : messages;
}

export function ConversationPane({
  isLanding,
  notebookId,
  nickname,
  messages,
  busy,
  stopAvailable,
  statusText,
  statusTone,
  generation,
  revisingOpenArtifact,
  composerTools,
  outputPreference,
  liveAssets,
  composerDockRef,
  scrollRef,
  nearBottomRef,
  onSend,
  onLiveSend,
  onStop,
  onMenuAction,
  onToolAction,
  onOutputPreferenceChange,
  onRetry,
  onPreviewHtml,
  onOpenArtifact,
  onToggleLiveAsset,
  onUploadLiveAsset,
  onOpenStatusCard,
  onDismissStatusCard,
  onLiveExit,
}: ConversationPaneProps) {
  const generationHasMessageCard = Boolean(
    generation?.artifactId &&
    messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.artifacts?.some(
          (artifact) => artifact.id === generation.artifactId,
        ),
    ),
  );
  const showStatusCard =
    generation !== null &&
    generation.phase !== 'confirm' &&
    (!generationHasMessageCard ||
      generation.revisionOutcome !== undefined ||
      generation.outcome === 'timed_out');
  const projectedMessages = projectArtifactGenerationIntoMessages(
    messages,
    generation,
  );
  const {
    assistantId,
    assistantText,
    assistantStatus,
    assistantArtifacts,
    assistantCitations,
    assistantToolSteps,
  } = useAssistantMessageProjection(projectedMessages);
  const liveArtifacts = assistantArtifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    status: artifact.status,
    previewUrl:
      artifact.id === generation?.artifactId &&
      generation.detail?.version?.media?.contentType.startsWith('image/')
        ? generation.detail.version.media.url
        : null,
  }));
  const liveCitations = assistantCitations.map((citation) => ({
    id: citation.id,
    label: citation.label,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
  }));
  const liveTools = assistantToolSteps;
  const liveAssetItems = liveAssets.map((asset) => ({
    id: asset.id,
    versionId: asset.versionId,
    label: asset.label,
    kind: asset.kind,
    scope: asset.scope,
    status: asset.status,
    enabled: asset.enabled,
    selectable: asset.selectable,
    previewUrl:
      asset.kind === 'image' && asset.status === 'ready'
        ? `/api/v1/chat/assets/${encodeURIComponent(asset.id)}/file`
        : null,
  }));
  const liveTranscript = messages
    .slice(-6)
    .filter((message) => message.text.trim().length > 0)
    .slice(-4)
    .map((message) => ({
      /* 持久化确认会替换 message.id；role + clientMessageId 跨替换稳定。 */
      id: `${message.role}:${message.clientMessageId}`,
      speaker: message.role === 'student' ? ('你' as const) : ('AI' as const),
      text: message.text,
    }));
  const handleStatusCardOpen = () => {
    const artifactId = generation?.artifactId;
    if (artifactId) onOpenStatusCard(artifactId);
  };
  const composerProps = {
    chips: [] as const,
    busy,
    statusText,
    statusTone,
    onSend,
    onStop,
    stopAvailable,
    onRemoveChip: () => undefined,
    onMenuAction,
    availableMenuActions: GENERAL_MENU_ACTIONS,
    toolChips: composerTools,
    onToolAction,
    outputPreference,
    onOutputPreferenceChange,
  };

  if (isLanding) {
    return (
      <EmptyChatHero as="section" nickname={nickname}>
        <div ref={composerDockRef} className="w-full">
          {showStatusCard ? (
            <div className="px-4">
              <ArtifactStatusCard
                generation={generation}
                onOpen={handleStatusCardOpen}
                onDismiss={onDismissStatusCard}
                dismissable={!revisingOpenArtifact}
              />
            </div>
          ) : null}
          <VoiceComposer
            {...composerProps}
            notebookId={notebookId}
            variant="landing"
            liveAssistantId={null}
            liveAssistantText={null}
            liveAssets={liveAssetItems}
          />
        </div>
      </EmptyChatHero>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="workspace-edge-scrollbar min-h-0 flex-1 overflow-y-auto"
        role="region"
        aria-label="AI 对话"
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottomRef.current =
            node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
        }}
      >
        <ChatPanel
          messages={projectedMessages}
          canvasOpen={false}
          artifactTitle=""
          onOpenCanvas={() => undefined}
          onContinueText={() => undefined}
          onRetry={onRetry}
          onPreviewHtml={({ source }) => onPreviewHtml(source)}
          onOpenArtifact={onOpenArtifact}
          assistantLabel="AI"
        />
        {showStatusCard ? (
          <div
            data-conversation-tail-artifact
            className="mx-auto w-full max-w-3xl px-4 pb-3"
          >
            <ArtifactStatusCard
              generation={generation}
              onOpen={handleStatusCardOpen}
              onDismiss={onDismissStatusCard}
              dismissable={!revisingOpenArtifact}
            />
          </div>
        ) : null}
      </div>
      <div ref={composerDockRef} className="relative z-10 px-4">
        <VoiceComposer
          {...composerProps}
          notebookId={notebookId}
          liveAssistantId={assistantId}
          liveAssistantText={assistantText}
          liveAssistantStatus={assistantStatus}
          liveTranscript={liveTranscript}
          liveAssets={liveAssetItems}
          onLiveSend={onLiveSend}
          liveArtifacts={liveArtifacts}
          liveCitations={liveCitations}
          liveTools={liveTools}
          onLiveToggleAsset={onToggleLiveAsset}
          onLiveUploadAsset={onUploadLiveAsset}
          onLiveExit={onLiveExit}
        />
      </div>
    </div>
  );
}
