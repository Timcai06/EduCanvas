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
  composerDockRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: RefObject<boolean>;
  onSend: (text: string) => void;
  onStop: () => void;
  onMenuAction: (action: PlusMenuActionId) => void;
  onToolAction: () => void;
  onRetry: (messageId: string) => void;
  onPreviewHtml: (source: string) => void;
  onOpenArtifact: (artifactId: string) => void;
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
  composerDockRef,
  scrollRef,
  nearBottomRef,
  onSend,
  onStop,
  onMenuAction,
  onToolAction,
  onRetry,
  onPreviewHtml,
  onOpenArtifact,
  onOpenStatusCard,
  onDismissStatusCard,
}: ConversationPaneProps) {
  const showStatusCard = generation !== null && generation.phase !== 'confirm';
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
          />
        </div>
      </EmptyChatHero>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
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
        <VoiceComposer {...composerProps} notebookId={notebookId} />
      </div>
    </div>
  );
}
