'use client';

import type { RefObject } from 'react';
import type { ChatMessage } from '@/features/chat/messages';
import { ChatPanel } from '@/features/chat/chat-panel';
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
  liveAssets: readonly AssetItem[];
  composerDockRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: RefObject<boolean>;
  onSend: (text: string) => void;
  onLiveSend: (text: string, context: LiveVoiceContextSnapshot) => void;
  onStop: () => void;
  onMenuAction: (action: PlusMenuActionId) => void;
  onToolAction: () => void;
  onRetry: (messageId: string) => void;
  onPreviewHtml: (source: string) => void;
  onOpenArtifact: (artifactId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onToggleLiveAsset: (assetId: string) => void;
  onUploadLiveAsset: (file: File, kind: 'image' | 'document') => Promise<void>;
  onOpenStatusCard: (artifactId: string) => void;
  onDismissStatusCard: () => void;
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
  liveAssets,
  composerDockRef,
  scrollRef,
  nearBottomRef,
  onSend,
  onLiveSend,
  onStop,
  onMenuAction,
  onToolAction,
  onRetry,
  onPreviewHtml,
  onOpenArtifact,
  onOpenAsset,
  onToggleLiveAsset,
  onUploadLiveAsset,
  onOpenStatusCard,
  onDismissStatusCard,
}: ConversationPaneProps) {
  const showStatusCard = generation !== null && generation.phase !== 'confirm';
  const liveAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  const liveArtifacts = [
    ...(liveAssistantMessage?.role === 'assistant'
      ? (liveAssistantMessage.artifacts ?? []).map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          title: artifact.title,
          status: artifact.status,
          previewUrl: null,
        }))
      : []),
    ...(generation?.artifactId &&
    !liveAssistantMessage?.artifacts?.some(
      (artifact) => artifact.id === generation.artifactId,
    )
      ? [
          {
            id: generation.artifactId,
            kind: generation.kind,
            title: generation.title,
            status:
              generation.phase === 'failed'
                ? ('failed' as const)
                : generation.phase === 'ready'
                  ? ('active' as const)
                  : ('generating' as const),
            previewUrl:
              generation.detail?.version?.media?.contentType.startsWith(
                'image/',
              )
                ? generation.detail.version.media.url
                : null,
          },
        ]
      : []),
  ];
  const liveCitations =
    liveAssistantMessage?.role === 'assistant'
      ? (liveAssistantMessage.citations ?? []).map((citation) => ({
          id: citation.id,
          label: citation.label,
          pageStart: citation.pageStart,
          pageEnd: citation.pageEnd,
        }))
      : [];
  const liveTools =
    liveAssistantMessage?.role === 'assistant'
      ? (liveAssistantMessage.toolSteps ?? [])
      : [];
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
          messages={messages}
          canvasOpen={false}
          artifactTitle=""
          onOpenCanvas={() => undefined}
          onContinueText={() => undefined}
          onRetry={onRetry}
          onPreviewHtml={({ source }) => onPreviewHtml(source)}
          onOpenArtifact={onOpenArtifact}
          assistantLabel="AI"
        />
      </div>
      <div ref={composerDockRef} className="relative z-10 px-4">
        {showStatusCard ? (
          <ArtifactStatusCard
            generation={generation}
            onOpen={handleStatusCardOpen}
            onDismiss={onDismissStatusCard}
            dismissable={!revisingOpenArtifact}
          />
        ) : null}
        <VoiceComposer
          {...composerProps}
          notebookId={notebookId}
          liveAssistantId={liveAssistantMessage?.clientMessageId ?? null}
          liveAssistantText={liveAssistantMessage?.text ?? null}
          liveAssistantStatus={liveAssistantMessage?.status ?? null}
          liveTranscript={liveTranscript}
          liveAssets={liveAssetItems}
          onLiveSend={onLiveSend}
          liveArtifacts={liveArtifacts}
          liveCitations={liveCitations}
          liveTools={liveTools}
          onLiveToggleAsset={onToggleLiveAsset}
          onLiveUploadAsset={onUploadLiveAsset}
          onLiveOpenAsset={onOpenAsset}
          onLiveOpenArtifact={onOpenArtifact}
        />
      </div>
    </div>
  );
}
