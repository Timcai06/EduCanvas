'use client';

import { startNewGeneralChatAction } from '@/app/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { AssetStatusNotice } from '@/features/assets/asset-status';
import { useNotebookSources } from './use-notebook-sources';
import { useWorkspaceSurface } from './use-workspace-surface';
import { useStudioOpenActions } from '@/features/canvas/use-studio-open-actions';
import { CanvasResourceOpenStatus } from '@/features/canvas/canvas-resource-open-status';
import type { CanvasResourceRendererProps } from '@/features/canvas/canvas-resource-registry';
import {
  ArtifactConfirmSheet,
  useArtifactGeneration,
} from '@/features/canvas/artifact-generation-flow';
import {
  fetchNotebookArtifacts,
  type ArtifactDetail,
  type ArtifactSummary,
} from '@/features/canvas/artifact-client';
import { OfflineBanner } from '@/features/chat/offline-banner';
import { useOnlineStatus } from '@/features/chat/use-online-status';
import { useSidebarState } from './use-sidebar-state';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import { useAgentTurn } from '@/features/chat/use-teaching-turn';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { motionDuration } from '@/features/theme/motion';
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
import {
  ConversationPane,
  type ConversationPaneProps,
} from './conversation-pane';
import {
  WorkspaceSurfaceSlot,
  type WorkspaceSurfaceSlotProps,
} from './workspace-surface-slot';
import { AgentBusyOverlay } from '../shared/agent-busy-overlay';
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
  /* W02：工作面互斥收敛到 useWorkspaceSurface（判别联合）。source 的 resource+Renderer
     属于详情数据，单独缓存；打开/关闭互斥由 reducer 保证，组件不再散落 setX(null)。 */
  const workspace = useWorkspaceSurface();
  const { surface } = workspace;
  const [sourceDetail, setSourceDetail] = useState<{
    readonly resource: CanvasResource;
    readonly Renderer: ComponentType<CanvasResourceRendererProps>;
  } | null>(null);
  const [studioItems, setStudioItems] = useState<readonly ArtifactSummary[]>(
    [],
  );
  const artifactFlow = useArtifactGeneration();
  const closeArtifactCanvas = useCallback(() => {
    workspace.dispatch({ type: 'close' });
    artifactFlow.closeCanvas();
  }, [artifactFlow, workspace]);
  const handleArtifactDeleted = (artifactId: string) => {
    closeArtifactCanvas();
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
      /* 验证成功后才开 surface：先缓存详情再 dispatch，渲染时 detail 与 surface 同步就绪。 */
      setSourceDetail({ resource, Renderer });
      workspace.openSource(resource.resourceId);
    },
    onArtifactValid: (resource) => {
      workspace.openArtifact(resource.resourceId);
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

  /* W02：landing 与对话共享同一组 ConversationPane props（两态只差 isLanding）。 */
  const conversationPaneProps = {
    nickname,
    messages: turn.messages,
    busy: turn.busy,
    stopAvailable: turn.stopAvailable,
    statusText: turn.statusText ?? error ?? sourceNotice?.message ?? null,
    statusTone: (!turn.busy && (error || sourceNotice?.tone === 'error')
      ? 'error'
      : 'info') as 'info' | 'error',
    generation: artifactFlow.generation,
    revisingOpenArtifact,
    composerTools,
    composerDockRef,
    scrollRef,
    nearBottomRef: nearBottom,
    onSend: send,
    onStop: () => void turn.stop(),
    onMenuAction: handleMenuAction,
    onToolAction: handleToolAction,
    onRetry: (messageId: string) => turn.retry(messageId),
    onPreviewHtml: (source: string) => workspace.openHtml(source),
    onOpenArtifact: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
    onOpenStatusCard: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
    onDismissStatusCard: artifactFlow.dismiss,
  } satisfies Omit<ConversationPaneProps, 'isLanding'>;

  /* W02：对话态分栏与 landing 全屏共用同一组槽位 props（只差 fullscreen）。 */
  const surfaceSlotProps = {
    surface,
    sourceDetail,
    artifactDetail: artifactFlow.openDetail,
    artifactCanvasFull: artifactFlow.canvasFull,
    revisingOpenArtifact,
    onToggleFullSurface: () => workspace.dispatch({ type: 'toggleFull' }),
    onToggleFullArtifact: () =>
      artifactFlow.setCanvasFull((value) => !value),
    onCloseSurface: () => workspace.dispatch({ type: 'close' }),
    onCloseArtifact: closeArtifactCanvas,
    onDeletedArtifact: handleArtifactDeleted,
    onSelectArtifactVersion: (artifactId: string, version: number) =>
      void artifactFlow.openArtifactVersion(artifactId, version),
    onReviseArtifact: (detail: ArtifactDetail, instruction: string) =>
      void artifactFlow.revise(detail, instruction),
    onSaveNote: (detail: ArtifactDetail, markdown: string) =>
      void artifactFlow.saveNote(detail, markdown),
  } satisfies Omit<WorkspaceSurfaceSlotProps, 'fullscreen'>;

  /* 落地 → 对话：输入坞 Flip 位移落到吸底位置；reduced-motion 直接跳变。 */
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const flipState = flipStateRef.current;
        if (flipState && !isLanding) {
          flipStateRef.current = null;
          Flip.from(flipState, {
            duration: motionDuration('slow'),
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
        studioOpen={surface.type === 'studio'}
        onToggleSidebar={toggleSidebar}
        onOpenStudio={() => {
          if (surface.type === 'studio') {
            workspace.closeStudio();
            return;
          }
          workspace.openStudio();
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
            <ConversationPane {...conversationPaneProps} isLanding />
          ) : (
            <div className="relative z-10 flex min-h-0 flex-1">
              <ConversationPane
                {...conversationPaneProps}
                isLanding={false}
              />
              {resourceOpenStatus ? (
                resourceOpenStatus
              ) : (
                <WorkspaceSurfaceSlot
                  {...surfaceSlotProps}
                  fullscreen={false}
                />
              )}
            </div>
          )}
        </main>
        {surface.type === 'studio' ? (
          <StudioOverlay onClose={() => workspace.closeStudio()}>
            <StudioWorkspace
              assets={notebookSources}
              outputs={studioItems}
              onOpenSource={(asset) => {
                workspace.closeStudio();
                artifactFlow.closeCanvas();
                studioOpenActions.actions.openSource(asset.id);
              }}
              onOpenOutput={(artifactId) => {
                workspace.closeStudio();
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
      {isLanding ? (
        /* 落地态没有分栏槽位,全屏打开。必须在 main(isolate 堆叠上下文)之外,
           否则内部 z-40 压不过兄弟 header 的 z-20;也不能进带 transform 的 hero。 */
        <WorkspaceSurfaceSlot {...surfaceSlotProps} fullscreen />
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
