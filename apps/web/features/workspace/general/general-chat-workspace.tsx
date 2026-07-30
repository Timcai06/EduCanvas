'use client';

import { startNewGeneralChatAction } from '@/app/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { AssetStatusNotice } from '@/features/assets/asset-status';
import { SourceResourceRenderer } from '@/features/assets/source-resource-renderer';
import { useNotebookSources } from './use-notebook-sources';
import { useStudioOpenActions } from '@/features/canvas/use-studio-open-actions';
import { CanvasResourceOpenStatus } from '@/features/canvas/canvas-resource-open-status';
import type { CanvasResourceRendererProps } from '@/features/canvas/canvas-resource-registry';
import {
  ArtifactCanvas,
  ArtifactConfirmSheet,
  ArtifactStatusCard,
  useArtifactGeneration,
} from '@/features/canvas/artifact-generation-flow';
import {
  fetchNotebookArtifacts,
  type ArtifactSummary,
} from '@/features/canvas/artifact-client';
import { HtmlPreviewPanel } from '@/features/canvas/html-preview-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import { OfflineBanner } from '@/features/chat/offline-banner';
import { useOnlineStatus } from '@/features/chat/use-online-status';
import { useSidebarState } from './use-sidebar-state';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import { useAgentTurn } from '@/features/chat/use-teaching-turn';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { StudioOverlay } from '@/features/studio/studio-overlay';
import { StudioWorkspace } from '@/features/studio/studio-workspace';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {
  PENDING_GENERAL_MENU_ACTION_KEY,
  PENDING_GENERAL_PROMPT_KEY,
  PENDING_GENERAL_CANVAS_KEY,
} from './general-chat-entry';
import { ConversationSidebar } from './conversation-sidebar';
import { AgentBusyOverlay } from '../shared/agent-busy-overlay';
import { EmptyChatHero } from '../shared/empty-chat-hero';
import { GeneralAssetEntrySheets } from './general-asset-entry-sheets';
import { GeneralWorkspaceHeader } from './general-workspace-header';
import { useAgentArtifactEvents } from './use-agent-artifact-events';
import {
  isArtifactRevisionInProgress,
  selectAudioArtifactSources,
} from './general-artifact-selection';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import {
  GENERAL_ASSET_ENDPOINT,
  GENERAL_MENU_ACTIONS,
  GENERAL_TURN_OPTIONS,
} from './general-chat-config';

gsap.registerPlugin(useGSAP, Flip);

export function GeneralChatWorkspace({
  initialMessages,
  conversationId,
  notebookTitle,
  nickname,
}: {
  initialMessages: readonly InitialChatMessageDTO[];
  conversationId: string;
  notebookTitle: string | null;
  nickname?: string | null;
}) {
  const [assetPanel, setAssetPanel] = useState<AssetItem['kind'] | null>(null);
  const [sourceResource, setSourceResource] = useState<{
    readonly resource: CanvasResource;
    readonly Renderer: ComponentType<CanvasResourceRendererProps>;
  } | null>(null);
  const [sourcePreviewFull, setSourcePreviewFull] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewFull, setPreviewFull] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioItems, setStudioItems] = useState<readonly ArtifactSummary[]>(
    [],
  );
  const artifactFlow = useArtifactGeneration();
  const handleArtifactDeleted = (artifactId: string) => {
    artifactFlow.closeCanvas();
    setStudioItems((items) => items.filter((item) => item.id !== artifactId));
  };
  const [canvasSelected, setCanvasSelected] = useState(false);
  const handleArtifactProposed = useAgentArtifactEvents({
    canvasSelected,
    setCanvasSelected,
    setStudioItems,
    observeProposedArtifact: artifactFlow.observeProposedArtifact,
  });
  const turn = useAgentTurn(initialMessages, GENERAL_TURN_OPTIONS, {
    onArtifactProposed: handleArtifactProposed,
  });
  const [error, setError] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<AssetStatusNotice | null>(
    null,
  );
  const studioOpenActions = useStudioOpenActions({
    scopeKey: conversationId,
    onSourceValid: (resource, Renderer) => {
      setSourceResource({ resource, Renderer });
      setSourcePreviewFull(false);
    },
    onArtifactValid: (resource) => {
      void artifactFlow.openArtifact(resource.resourceId);
    },
  });
  const mainRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const flipStateRef = useRef<Flip.FlipState | null>(null);
  const nearBottom = useRef(true);
  const pendingConsumed = useRef(false);
  const pendingMenuConsumed = useRef(false);
  const pendingToolsConsumed = useRef(false);

  const sources = useNotebookSources({
    endpoint: GENERAL_ASSET_ENDPOINT,
    onError: setError,
    onStatus: setSourceNotice,
  });
  const { assets, setAssets } = sources;
  const refreshAssets = sources.refresh;

  useEffect(() => {
    const container = scrollRef.current;
    if (container && nearBottom.current)
      container.scrollTop = container.scrollHeight;
  }, [turn.messages]);

  const send = useCallback(
    (text: string) => {
      setError(null);
      setSourceNotice(null);
      /* Flip 三段式:状态翻转前捕获输入坞位置,渲染后由下方 useGSAP 播放位移。 */
      if (turn.messages.length === 0 && composerDockRef.current) {
        flipStateRef.current = Flip.getState(composerDockRef.current);
      }
      const selected = assets.flatMap((asset) =>
        asset.enabled && asset.versionId
          ? [
              {
                type: 'asset_ref' as const,
                reference: {
                  assetId: asset.id,
                  versionId: asset.versionId,
                  kind: asset.kind,
                },
                /* usage 跟随 scope：笔记本长期来源是背景上下文，只在 Studio 里管理；
                   仅本轮的附件才属于这条消息，会在气泡里留痕。此前一律写死
                   'context'，导致每条提问都把全部来源重新盖一遍章。 */
                usage:
                  asset.scope === 'space'
                    ? ('context' as const)
                    : ('attachment' as const),
                label: asset.label,
              },
            ]
          : [],
      );
      void turn
        .send(
          text,
          undefined,
          selected,
          canvasSelected ? { outputPreference: 'canvas' } : {},
        )
        .then((accepted) => {
          if (!accepted) return;
          if (canvasSelected) setCanvasSelected(false);
          setAssets((current) =>
            current.map((asset) =>
              asset.scope === 'turn' ? { ...asset, enabled: false } : asset,
            ),
          );
          void refreshAssets().catch(() => undefined);
        });
    },
    [assets, canvasSelected, refreshAssets, setAssets, turn],
  );

  useEffect(() => {
    if (pendingConsumed.current) return;
    pendingConsumed.current = true;
    const prompt = sessionStorage.getItem(PENDING_GENERAL_PROMPT_KEY);
    if (!prompt) return;
    sessionStorage.removeItem(PENDING_GENERAL_PROMPT_KEY);
    queueMicrotask(() => send(prompt));
  }, [send]);

  const handleMenuAction = useCallback(
    (action: PlusMenuActionId) => {
      if (action === 'upload_file') setAssetPanel('document');
      else if (action === 'upload_image') setAssetPanel('image');
      else if (action === 'add_link') setAssetPanel('link');
      else if (action === 'create_mind_map') {
        artifactFlow.beginConfirm('mind_map', '对话思维导图');
      } else if (action === 'create_slides') {
        artifactFlow.beginConfirm('slides', '对话小结 Slides');
      } else if (action === 'create_flashcards') {
        artifactFlow.beginConfirm('flashcards', '复习闪卡');
      } else if (action === 'create_audio_overview') {
        artifactFlow.beginConfirm('audio_overview', '来源音频概览');
      } else if (action === 'create_note') {
        artifactFlow.beginConfirm('note', '对话笔记');
      }
    },
    [artifactFlow],
  );

  useEffect(() => {
    if (pendingMenuConsumed.current) return;
    pendingMenuConsumed.current = true;
    const action = sessionStorage.getItem(
      PENDING_GENERAL_MENU_ACTION_KEY,
    ) as PlusMenuActionId | null;
    if (!action) return;
    sessionStorage.removeItem(PENDING_GENERAL_MENU_ACTION_KEY);
    queueMicrotask(() => handleMenuAction(action));
  }, [handleMenuAction]);

  useEffect(() => {
    if (pendingToolsConsumed.current) return;
    pendingToolsConsumed.current = true;
    const restoreCanvas = Boolean(
      sessionStorage.getItem(PENDING_GENERAL_CANVAS_KEY),
    );
    sessionStorage.removeItem(PENDING_GENERAL_CANVAS_KEY);
    queueMicrotask(() => {
      if (restoreCanvas) setCanvasSelected(true);
    });
  }, []);

  const online = useOnlineStatus();
  const { open: sidebarOpen, toggle: toggleSidebar } = useSidebarState();
  const isLanding = turn.messages.length === 0;
  const notebookSources = assets.filter((asset) => asset.scope === 'space');
  const composerTools = [
    { id: 'canvas' as const, label: 'Canvas', selected: canvasSelected },
  ];
  const handleToolAction = useCallback(() => {
    setCanvasSelected((selected) => !selected);
  }, []);
  const selectedAudioSources = selectAudioArtifactSources(notebookSources);
  const revisingOpenArtifact = isArtifactRevisionInProgress(artifactFlow);
  const resourceOpenStatus =
    studioOpenActions.pendingKind || studioOpenActions.validationError ? (
      <CanvasResourceOpenStatus
        pendingKind={studioOpenActions.pendingKind}
        error={studioOpenActions.validationError}
        onRetry={studioOpenActions.retry}
        onClose={studioOpenActions.close}
      />
    ) : null;

  /* 落地 → 对话：输入坞 Flip 位移落到吸底位置；reduced-motion 直接跳变。 */
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const flipState = flipStateRef.current;
        if (flipState && !isLanding) {
          flipStateRef.current = null;
          Flip.from(flipState, {
            duration: 0.6,
            ease: 'power3.inOut',
            scale: false,
          });
        }
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        flipStateRef.current = null;
      });
      return () => media.revert();
    },
    { scope: mainRef, dependencies: [isLanding] },
  );

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <GeneralWorkspaceHeader
        notebookTitle={notebookTitle}
        conversationId={conversationId}
        sidebarOpen={sidebarOpen}
        studioOpen={studioOpen}
        onToggleSidebar={toggleSidebar}
        onOpenStudio={() => {
          const opening = !studioOpen;
          setStudioOpen(opening);
          if (!opening) return;
          void fetchNotebookArtifacts()
            .then(setStudioItems)
            .catch(() => setStudioItems([]));
        }}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ConversationSidebar
          open={sidebarOpen}
          onClose={toggleSidebar}
          activeConversationId={conversationId}
          onNewNotebook={() => void startNewGeneralChatAction()}
        />
        <main
          ref={mainRef}
          className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {!online ? (
            <div className="relative z-10 shrink-0 pt-1">
              <OfflineBanner />
            </div>
          ) : null}
          {isLanding ? (
            <EmptyChatHero as="section" nickname={nickname}>
              <div ref={composerDockRef} className="w-full">
                {artifactFlow.generation &&
                artifactFlow.generation.phase !== 'confirm' ? (
                  <div className="px-4">
                    <ArtifactStatusCard
                      generation={artifactFlow.generation}
                      onOpen={() => {
                        const artifactId = artifactFlow.generation?.artifactId;
                        if (artifactId) {
                          setSourceResource(null);
                          studioOpenActions.actions.openArtifact(artifactId);
                        }
                      }}
                      onDismiss={artifactFlow.dismiss}
                      dismissable={!revisingOpenArtifact}
                    />
                  </div>
                ) : null}
                <Composer
                  chips={[]}
                  busy={turn.busy}
                  statusText={
                    turn.statusText ?? error ?? sourceNotice?.message ?? null
                  }
                  statusTone={
                    !turn.busy && (error || sourceNotice?.tone === 'error')
                      ? 'error'
                      : 'info'
                  }
                  onSend={send}
                  onStop={() => void turn.stop()}
                  stopAvailable={turn.stopAvailable}
                  onRemoveChip={() => undefined}
                  onMenuAction={handleMenuAction}
                  availableMenuActions={GENERAL_MENU_ACTIONS}
                  toolChips={composerTools}
                  onToolAction={handleToolAction}
                  variant="landing"
                />
              </div>
            </EmptyChatHero>
          ) : (
            <div className="relative z-10 flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  ref={scrollRef}
                  className="min-h-0 flex-1 overflow-y-auto"
                  role="region"
                  aria-label="AI 对话"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    nearBottom.current =
                      node.scrollHeight - node.scrollTop - node.clientHeight <=
                      96;
                  }}
                >
                  <ChatPanel
                    messages={turn.messages}
                    canvasOpen={false}
                    artifactTitle=""
                    onOpenCanvas={() => undefined}
                    onContinueText={() => undefined}
                    onRetry={(messageId) => turn.retry(messageId)}
                    onPreviewHtml={({ source }) => {
                      setSourceResource(null);
                      setSourcePreviewFull(false);
                      setPreviewHtml(source);
                    }}
                    onOpenArtifact={(artifactId) => {
                      setSourceResource(null);
                      setSourcePreviewFull(false);
                      setPreviewHtml(null);
                      studioOpenActions.actions.openArtifact(artifactId);
                    }}
                    assistantLabel="AI"
                  />
                </div>
                <div ref={composerDockRef} className="relative z-10 px-4">
                  {artifactFlow.generation &&
                  artifactFlow.generation.phase !== 'confirm' ? (
                    <ArtifactStatusCard
                      generation={artifactFlow.generation}
                      onOpen={() => {
                        const artifactId = artifactFlow.generation?.artifactId;
                        if (artifactId) {
                          setSourceResource(null);
                          studioOpenActions.actions.openArtifact(artifactId);
                        }
                      }}
                      onDismiss={artifactFlow.dismiss}
                      dismissable={!revisingOpenArtifact}
                    />
                  ) : null}
                  <Composer
                    chips={[]}
                    busy={turn.busy}
                    statusText={
                      turn.statusText ?? error ?? sourceNotice?.message ?? null
                    }
                    statusTone={
                      !turn.busy && (error || sourceNotice?.tone === 'error')
                        ? 'error'
                        : 'info'
                    }
                    onSend={send}
                    onStop={() => void turn.stop()}
                    stopAvailable={turn.stopAvailable}
                    onRemoveChip={() => undefined}
                    onMenuAction={handleMenuAction}
                    availableMenuActions={GENERAL_MENU_ACTIONS}
                    toolChips={composerTools}
                    onToolAction={handleToolAction}
                  />
                </div>
              </div>
              {resourceOpenStatus ? (
                resourceOpenStatus
              ) : artifactFlow.openDetail ? (
                <ArtifactCanvas
                  detail={artifactFlow.openDetail}
                  isFull={artifactFlow.canvasFull}
                  onToggleFull={() =>
                    artifactFlow.setCanvasFull((value) => !value)
                  }
                  onClose={artifactFlow.closeCanvas}
                  onDeleted={handleArtifactDeleted}
                  onSelectVersion={(version) =>
                    void artifactFlow.openArtifactVersion(
                      artifactFlow.openDetail!.artifact.id,
                      version,
                    )
                  }
                  onRevise={(instruction) =>
                    void artifactFlow.revise(
                      artifactFlow.openDetail!,
                      instruction,
                    )
                  }
                  onSaveNote={(markdown) =>
                    void artifactFlow.saveNote(
                      artifactFlow.openDetail!,
                      markdown,
                    )
                  }
                  revising={revisingOpenArtifact}
                />
              ) : sourceResource ? (
                <SourceResourceRenderer
                  key={`${sourceResource.resource.resourceId}:${sourceResource.resource.version?.versionId ?? 'none'}`}
                  resource={sourceResource.resource}
                  Renderer={sourceResource.Renderer}
                  isFull={sourcePreviewFull}
                  onToggleFull={() => setSourcePreviewFull((value) => !value)}
                  onClose={() => {
                    setSourceResource(null);
                    setSourcePreviewFull(false);
                  }}
                />
              ) : previewHtml !== null ? (
                <HtmlPreviewPanel
                  source={previewHtml}
                  isFull={previewFull}
                  onToggleFull={() => setPreviewFull((value) => !value)}
                  onClose={() => {
                    setPreviewHtml(null);
                    setPreviewFull(false);
                  }}
                />
              ) : null}
            </div>
          )}
        </main>
        {studioOpen ? (
          <StudioOverlay onClose={() => setStudioOpen(false)}>
            <StudioWorkspace
              assets={notebookSources}
              outputs={studioItems}
              onOpenSource={(asset) => {
                setStudioOpen(false);
                artifactFlow.closeCanvas();
                setPreviewHtml(null);
                setSourceResource(null);
                studioOpenActions.actions.openSource(asset.id);
              }}
              onOpenOutput={(artifactId) => {
                setStudioOpen(false);
                setSourceResource(null);
                setSourcePreviewFull(false);
                studioOpenActions.actions.openArtifact(artifactId);
              }}
              onToggleSource={sources.toggle}
              onRenameSource={sources.rename}
              onDeleteSource={sources.remove}
            />
          </StudioOverlay>
        ) : null}
      </div>
      {/* Agent 工作态全屏氛围层：老师思考到给出回复期间浮起边缘流光，绑 turn.busy */}
      <AgentBusyOverlay active={turn.busy} />
      {isLanding ? resourceOpenStatus : null}
      {isLanding && artifactFlow.openDetail ? (
        /* 落地态没有分栏槽位,全屏打开。必须在 main(isolate 堆叠上下文)之外,
           否则内部 z-40 压不过兄弟 header 的 z-20;也不能进带 transform 的 hero。 */
        <ArtifactCanvas
          detail={artifactFlow.openDetail}
          isFull
          onToggleFull={() => undefined}
          onClose={artifactFlow.closeCanvas}
          onDeleted={handleArtifactDeleted}
          onSelectVersion={(version) =>
            void artifactFlow.openArtifactVersion(
              artifactFlow.openDetail!.artifact.id,
              version,
            )
          }
          onRevise={(instruction) =>
            void artifactFlow.revise(artifactFlow.openDetail!, instruction)
          }
          onSaveNote={(markdown) =>
            void artifactFlow.saveNote(artifactFlow.openDetail!, markdown)
          }
          revising={revisingOpenArtifact}
        />
      ) : null}
      {isLanding && sourceResource ? (
        <SourceResourceRenderer
          key={`${sourceResource.resource.resourceId}:${sourceResource.resource.version?.versionId ?? 'none'}`}
          resource={sourceResource.resource}
          Renderer={sourceResource.Renderer}
          isFull
          onToggleFull={() => undefined}
          onClose={() => {
            setSourceResource(null);
            setSourcePreviewFull(false);
          }}
        />
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {turn.announcement?.text ?? sourceNotice?.message ?? ''}
      </p>
      {artifactFlow.generation?.phase === 'confirm' ? (
        <ArtifactConfirmSheet
          kind={artifactFlow.generation.kind}
          defaultTitle={artifactFlow.generation.title}
          sourceCount={selectedAudioSources.length}
          onConfirm={(title) => {
            const openWhenReady = canvasSelected;
            setCanvasSelected(false);
            void artifactFlow.confirm(
              artifactFlow.generation!.kind,
              title,
              selectedAudioSources,
              { openWhenReady },
            );
          }}
          onClose={artifactFlow.dismiss}
        />
      ) : null}
      <GeneralAssetEntrySheets
        active={assetPanel}
        endpoint={GENERAL_ASSET_ENDPOINT}
        onClose={() => setAssetPanel(null)}
        onAdded={(asset) => {
          setAssets((current) => [
            { ...asset, enabled: asset.selectable },
            ...current.filter((item) => item.id !== asset.id),
          ]);
          setAssetPanel(null);
        }}
      />
    </div>
  );
}
